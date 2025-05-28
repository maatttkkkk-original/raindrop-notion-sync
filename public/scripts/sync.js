// FIXED Reset & Full Sync - No More Infinite Loop
async function performResetAndFullSync(limit = 0) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`🔄 Reset & Full Sync starting - Lock ID: ${lockId}`);
  
  let createdCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  
  try {
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      console.log(`🔄 [${lockId}] ${message}`);
      
      const updateData = {
        message: `${message}`,
        type,
        counts: { created: createdCount, deleted: deletedCount, failed: failedCount },
        lockInfo: {
          locked: GLOBAL_SYNC_LOCK,
          lockId: lockId,
          duration: SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0
        }
      };
      
      if (currentSync) {
        currentSync.counts = updateData.counts;
      }
      
      broadcastSSEData(updateData);
    };
    
    sendUpdate('🔄 Starting Reset & Full Sync', 'info');
    
    // === STEP 1: DELETE ALL EXISTING NOTION PAGES (FIXED) ===
    sendUpdate('🗑️ Fetching existing Notion pages for deletion...', 'processing');
    
    let existingPages = [];
    let totalDeleted = 0;
    let maxDeletionAttempts = 5; // Prevent infinite loops
    let deletionAttempt = 0;
    
    // FIXED: Keep deleting until no pages remain, but with safety limit
    while (deletionAttempt < maxDeletionAttempts) {
      deletionAttempt++;
      
      try {
        // Get current pages
        existingPages = await getNotionPages();
        sendUpdate(`🔍 Deletion attempt ${deletionAttempt}: Found ${existingPages.length} pages`, 'info');
        
        if (existingPages.length === 0) {
          sendUpdate('✅ No more pages found - deletion complete!', 'success');
          break;
        }
        
        // Delete this batch
        sendUpdate(`🗑️ Deleting ${existingPages.length} pages (attempt ${deletionAttempt})...`, 'processing');
        
        const deleteChunks = chunkArray(existingPages, 10);
        
        for (let i = 0; i < deleteChunks.length; i++) {
          const chunk = deleteChunks[i];
          sendUpdate(`🗑️ Deleting batch ${i + 1}/${deleteChunks.length} (${chunk.length} pages)`, 'processing');
          
          for (const page of chunk) {
            try {
              await deleteNotionPage(page.id);
              deletedCount++;
              totalDeleted++;
              
              if (deletedCount % 20 === 0) {
                sendUpdate(`🗑️ Deleted ${totalDeleted} total pages so far`, 'processing');
              }
              
              // PROVEN WORKING DELAY: 200ms between deletions
              await new Promise(resolve => setTimeout(resolve, 200));
              
            } catch (error) {
              sendUpdate(`❌ Failed to delete page: ${error.message}`, 'failed');
              failedCount++;
              await new Promise(resolve => setTimeout(resolve, 400));
            }
          }
          
          // PROVEN WORKING DELAY: 2000ms between batches
          if (i < deleteChunks.length - 1) {
            sendUpdate(`⏳ Deletion batch ${i + 1} complete, waiting...`, 'info');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        // Wait before checking again to allow Notion to process
        sendUpdate(`⏳ Waiting for Notion to process deletions...`, 'info');
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second wait
        
      } catch (error) {
        sendUpdate(`❌ Error in deletion attempt ${deletionAttempt}: ${error.message}`, 'failed');
        // Continue to next attempt
      }
    }
    
    // Final check
    try {
      const finalPages = await getNotionPages();
      if (finalPages.length > 0) {
        sendUpdate(`⚠️ Warning: ${finalPages.length} pages still remain after ${maxDeletionAttempts} attempts`, 'warning');
        sendUpdate(`🔄 Proceeding with sync anyway - these may be system pages`, 'info');
      } else {
        sendUpdate(`✅ Database reset complete: ${totalDeleted} pages deleted`, 'success');
      }
    } catch (error) {
      sendUpdate(`⚠️ Could not verify final deletion status: ${error.message}`, 'warning');
      sendUpdate(`🔄 Proceeding with sync anyway`, 'info');
    }
    
    // === STEP 2: FETCH ALL RAINDROPS ===
    sendUpdate('📡 Fetching all Raindrop bookmarks...', 'fetching');
    
    let raindrops = [];
    try {
      raindrops = await getAllRaindrops(limit);
    } catch (error) {
      throw new Error(`Failed to fetch raindrops: ${error.message}`);
    }
    
    sendUpdate(`✅ Found ${raindrops.length} Raindrop bookmarks to sync`, 'success');
    
    if (raindrops.length === 0) {
      sendUpdate('No raindrops to sync. Process complete.', 'complete');
      broadcastSSEData({ complete: true });
      return { complete: true };
    }
    
    // === STEP 3: CREATE ALL PAGES ===
    sendUpdate(`📝 Creating ${raindrops.length} new Notion pages...`, 'processing');
    
    // Reset creation counter since we're starting fresh
    createdCount = 0;
    
    // Create in batches using PROVEN WORKING TIMINGS
    const batches = chunkArray(raindrops, 10);
    const batchCount = batches.length;
    
    for (let i = 0; i < batchCount; i++) {
      const batch = batches[i];
      sendUpdate(`📝 Processing batch ${i + 1}/${batchCount} (${batch.length} pages)`, 'processing');
      
      for (const item of batch) {
        try {
          const result = await createNotionPage(item);
          if (result.success) {
            createdCount++;
            sendUpdate(`✅ Created: "${item.title}"`, 'added');
            
            if (createdCount % 20 === 0) {
              sendUpdate(`📊 Progress: ${createdCount}/${raindrops.length} pages created`, 'info');
            }
          } else {
            sendUpdate(`❌ Failed to create: "${item.title}"`, 'failed');
            failedCount++;
          }
          
          // PROVEN WORKING DELAY: 200ms between operations
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          sendUpdate(`❌ Error creating "${item.title}": ${error.message}`, 'failed');
          failedCount++;
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
      
      // PROVEN WORKING DELAY: 2000ms between batches
      if (i < batchCount - 1) {
        sendUpdate(`⏳ Batch ${i + 1} complete, waiting before next batch...`, 'info');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // === FINAL SUMMARY ===
    const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    
    sendUpdate(`🎉 Reset & Full Sync completed in ${duration}s!`, 'complete');
    sendUpdate(`📊 Results: ${createdCount} created, ${totalDeleted} deleted, ${failedCount} failed`, 'summary');
    
    console.log(`✅ [${lockId}] RESET & FULL SYNC COMPLETE: ${duration}s`);
    
    if (currentSync) {
      currentSync.completed = true;
      currentSync.isRunning = false;
    }
    
    broadcastSSEData({ 
      complete: true,
      finalCounts: { created: createdCount, deleted: totalDeleted, failed: failedCount },
      mode: 'reset',
      duration
    });
    
    return { complete: true };
    
  } catch (error) {
    console.error(`❌ [${lockId}] RESET & FULL SYNC ERROR:`, error);
    broadcastSSEData({
      message: `Reset & Full Sync failed: ${error.message}`,
      type: 'failed',
      complete: true
    });
    throw error;
  }
}