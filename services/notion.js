// File: services/notion.js
'use strict';

const fetch = require('node-fetch');

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Conservative rate limiting for large datasets
const RATE_LIMIT_CONFIG = {
  baseDelay: 800,           // 800ms between requests (conservative)
  maxRetries: 5,            // Max retry attempts
  backoffMultiplier: 2,     // Exponential backoff
  maxBackoffDelay: 30000,   // Max 30 seconds between retries
  pageSize: 50,             // Smaller page size for stability
  batchTimeout: 60000       // 60 second timeout per batch
};

/**
 * Sleep utility for delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attempt) {
  const delay = RATE_LIMIT_CONFIG.baseDelay * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, attempt);
  return Math.min(delay, RATE_LIMIT_CONFIG.maxBackoffDelay);
}

/**
 * Robust API call with retry logic and rate limiting
 */
async function makeNotionAPICall(url, options = {}, attempt = 0) {
  const maxRetries = RATE_LIMIT_CONFIG.maxRetries;
  
  try {
    // Add conservative delay before each request (except first attempt)
    if (attempt > 0) {
      const backoffDelay = calculateBackoffDelay(attempt - 1);
      console.log(`⏳ Backing off for ${backoffDelay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
      await sleep(backoffDelay);
    } else {
      // Even first requests get a base delay for politeness
      await sleep(RATE_LIMIT_CONFIG.baseDelay);
    }
    
    const response = await fetch(url, {
      timeout: RATE_LIMIT_CONFIG.batchTimeout,
      ...options,
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    // Handle rate limiting with exponential backoff
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : calculateBackoffDelay(attempt);
      
      console.log(`⏰ Rate limited. Waiting ${waitTime}ms before retry...`);
      await sleep(waitTime);
      
      if (attempt < maxRetries) {
        return makeNotionAPICall(url, options, attempt + 1);
      } else {
        throw new Error(`Rate limited after ${maxRetries} retries`);
      }
    }
    
    // Handle other HTTP errors
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      
      // Some errors are worth retrying (5xx, timeouts)
      const retryableStatuses = [500, 502, 503, 504];
      if (retryableStatuses.includes(response.status) && attempt < maxRetries) {
        console.log(`🔄 Retryable error ${response.status}, attempt ${attempt + 1}/${maxRetries + 1}`);
        return makeNotionAPICall(url, options, attempt + 1);
      }
      
      throw new Error(`Notion API error (${response.status}): ${errorData.message || response.statusText}`);
    }
    
    return await response.json();
    
  } catch (error) {
    // Handle network errors with retry
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.type === 'request-timeout') {
      if (attempt < maxRetries) {
        console.log(`🌐 Network error, retrying... (attempt ${attempt + 1}/${maxRetries + 1})`);
        return makeNotionAPICall(url, options, attempt + 1);
      }
    }
    
    console.error(`❌ Notion API call failed:`, error.message);
    throw error;
  }
}

/**
 * Helper function to normalize URLs for comparison
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Helper function to normalize titles for comparison
 */
function normalizeTitle(title) {
  return (title || '').trim().toLowerCase();
}

/**
 * Get all pages from the Notion database with robust pagination and rate limiting
 */
async function getNotionPages() {
  console.log('📚 Starting Notion pages fetch with conservative rate limiting...');
  
  const pages = [];
  let hasMore = true;
  let startCursor = null;
  let requestCount = 0;
  let totalFetchTime = Date.now();
  
  try {
    while (hasMore) {
      const batchStartTime = Date.now();
      
      console.log(`📄 Fetching Notion pages batch ${requestCount + 1} (${pages.length} pages so far)...`);
      
      const requestBody = {
        page_size: RATE_LIMIT_CONFIG.pageSize
      };
      
      if (startCursor) {
        requestBody.start_cursor = startCursor;
      }
      
      const data = await makeNotionAPICall(
        `${NOTION_API_URL}/databases/${process.env.NOTION_DB_ID}/query`,
        {
          method: 'POST',
          body: JSON.stringify(requestBody)
        }
      );
      
      const batchPages = data.results || [];
      pages.push(...batchPages);
      hasMore = data.has_more;
      startCursor = data.next_cursor;
      requestCount++;
      
      const batchTime = Date.now() - batchStartTime;
      console.log(`✅ Batch ${requestCount} complete: ${batchPages.length} pages in ${batchTime}ms (total: ${pages.length})`);
      
      // Safety check to prevent infinite loops
      if (requestCount > 200) { // Reasonable max for very large databases
        console.warn(`⚠️ Reached maximum batch limit (${requestCount}), stopping fetch`);
        break;
      }
      
      // Progress update every 5 batches
      if (requestCount % 5 === 0) {
        const elapsed = Math.round((Date.now() - totalFetchTime) / 1000);
        console.log(`🕐 Progress: ${pages.length} pages fetched in ${elapsed}s (${requestCount} API calls)`);
      }
    }
    
    const totalTime = Math.round((Date.now() - totalFetchTime) / 1000);
    const avgTimePerBatch = Math.round(totalTime / requestCount * 1000);
    
    console.log(`🎉 Notion fetch complete: ${pages.length} pages in ${totalTime}s (${requestCount} API calls, ${avgTimePerBatch}ms avg/batch)`);
    
    return pages;
    
  } catch (error) {
    const partialTime = Math.round((Date.now() - totalFetchTime) / 1000);
    console.error(`❌ Notion fetch failed after ${partialTime}s with ${pages.length} pages retrieved:`, error.message);
    
    // Return partial results if we got some data
    if (pages.length > 0) {
      console.log(`🔄 Returning ${pages.length} partial results`);
      return pages;
    }
    
    throw error;
  }
}

/**
 * Get total count of pages in the Notion database
 */
async function getTotalNotionPages() {
  try {
    console.log('🔢 Getting total Notion page count...');
    const pages = await getNotionPages();
    console.log(`📊 Total Notion pages: ${pages.length}`);
    return pages.length;
  } catch (error) {
    console.error('❌ Error getting Notion page count:', error.message);
    throw error;
  }
}

/**
 * Delete a Notion page (archive it) with retry logic
 */
async function deleteNotionPage(pageId) {
  try {
    console.log(`🗑️ Deleting Notion page: ${pageId}`);
    
    await makeNotionAPICall(`${NOTION_API_URL}/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true })
    });
    
    console.log(`✅ Successfully deleted page: ${pageId}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Failed to delete page ${pageId}:`, error.message);
    throw error;
  }
}

/**
 * Update a Notion page with raindrop data
 */
async function updateNotionPage(pageId, item) {
  try {
    console.log(`🔄 Updating Notion page: ${pageId} - "${item.title}"`);
    
    const page = {
      properties: {
        Name: { title: [{ text: { content: item.title || 'Untitled' } }] },
        URL: { url: item.link },
        Tags: {
          multi_select: (item.tags || []).map(tag => ({ name: tag }))
        }
      }
    };
    
    await makeNotionAPICall(`${NOTION_API_URL}/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify(page)
    });
    
    console.log(`✅ Successfully updated page: ${pageId}`);
    
    // Handle image updates asynchronously with conservative delays
    const imageUrl = item.cover || 
                    (item.media && item.media.length > 0 && item.media[0] && item.media[0].link) || 
                    (item.preview && item.preview.length > 0 && item.preview[0]);
                    
    if (imageUrl) {
      // Use a longer delay for image updates to be conservative
      setTimeout(async () => {
        try {
          await updateNotionPageImage(pageId, imageUrl);
        } catch (imageError) {
          console.warn(`⚠️ Image update failed for page ${pageId}: ${imageError.message}`);
        }
      }, 1500); // Increased delay for image updates
    }
    
    return true;
    
  } catch (error) {
    console.error(`❌ Failed to update page ${pageId}:`, error.message);
    throw error;
  }
}

/**
 * Update the image block of a Notion page with enhanced validation
 */
async function updateNotionPageImage(pageId, imageUrl) {
  try {
    // Enhanced image URL validation
    if (!imageUrl || typeof imageUrl !== 'string') {
      return false;
    }
    
    // Validate URL format
    let validUrl;
    try {
      validUrl = new URL(imageUrl);
      if (validUrl.protocol !== 'https:' && validUrl.protocol !== 'http:') {
        console.log(`⚠️ Skipping image with unsupported protocol: ${validUrl.protocol}`);
        return false;
      }
    } catch (e) {
      console.log(`⚠️ Skipping malformed image URL: ${imageUrl}`);
      return false;
    }
    
    // Check for valid image patterns
    const imagePatterns = [
      /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i,
      /image/i,
      /img/i,
      /thumbnail/i,
      /asset/i,
      /media/i
    ];
    
    const isValidImage = imagePatterns.some(pattern => pattern.test(imageUrl));
    if (!isValidImage) {
      console.log(`⚠️ URL doesn't appear to be an image: ${imageUrl}`);
      return false;
    }
    
    // Get existing blocks
    const blocksData = await makeNotionAPICall(`${NOTION_API_URL}/blocks/${pageId}/children`);
    
    let imageBlockId = null;
    if (blocksData.results) {
      for (const block of blocksData.results) {
        if (block.type === 'image') {
          imageBlockId = block.id;
          break;
        }
      }
    }
    
    if (imageBlockId) {
      // Update existing image block
      await makeNotionAPICall(`${NOTION_API_URL}/blocks/${imageBlockId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          image: {
            type: 'external',
            external: { url: imageUrl }
          }
        })
      });
    } else {
      // Create new image block
      await makeNotionAPICall(`${NOTION_API_URL}/blocks/${pageId}/children`, {
        method: 'PATCH',
        body: JSON.stringify({
          children: [{
            object: 'block',
            type: 'image',
            image: {
              type: 'external',
              external: { url: imageUrl }
            }
          }]
        })
      });
    }
    
    return true;
    
  } catch (error) {
    console.error(`❌ Image update failed for page ${pageId}:`, error.message);
    return false; // Image failures shouldn't break the main sync
  }
}

/**
 * Create a new Notion page from raindrop data
 */
async function createNotionPage(item) {
  try {
    console.log(`📝 Creating Notion page: "${item.title}"`);
    
    const page = {
      parent: { database_id: process.env.NOTION_DB_ID },
      properties: {
        Name: { title: [{ text: { content: item.title || 'Untitled' } }] },
        URL: { url: item.link },
        Tags: {
          multi_select: (item.tags || []).map(tag => ({ name: tag }))
        }
      }
    };
    
    const createdPage = await makeNotionAPICall(`${NOTION_API_URL}/pages`, {
      method: 'POST',
      body: JSON.stringify(page)
    });
    
    const pageId = createdPage.id;
    console.log(`✅ Successfully created page: ${pageId} - "${item.title}"`);
    
    // Handle image creation asynchronously
    const imageUrl = item.cover || 
                    (item.media && item.media.length > 0 && item.media[0] && item.media[0].link) || 
                    (item.preview && item.preview.length > 0 && item.preview[0]);
                    
    if (imageUrl) {
      setTimeout(async () => {
        try {
          await updateNotionPageImage(pageId, imageUrl);
        } catch (imageError) {
          console.warn(`⚠️ Image creation failed for page ${pageId}: ${imageError.message}`);
        }
      }, 1500);
    }
    
    return { success: true, pageId };
    
  } catch (error) {
    console.error(`❌ Failed to create page for "${item.title}":`, error.message);
    return { success: false, error: error.message };
  }
}

// Export functions
module.exports = { 
  getNotionPages,
  getTotalNotionPages,
  deleteNotionPage,
  updateNotionPage,
  createNotionPage
};