// File: services/raindrop.js
'use strict';

const fetch = require('node-fetch');

// Conservative rate limiting configuration
const RATE_LIMIT_CONFIG = {
  baseDelay: 600,           // 600ms between requests
  maxRetries: 5,            // Max retry attempts
  backoffMultiplier: 2,     // Exponential backoff
  maxBackoffDelay: 30000,   // Max 30 seconds between retries
  pageSize: 50,             // Raindrop's max per page
  batchTimeout: 60000,      // 60 second timeout per batch
  maxPages: 100             // Safety limit for very large collections
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
async function makeRaindropAPICall(url, options = {}, attempt = 0) {
  const maxRetries = RATE_LIMIT_CONFIG.maxRetries;
  
  try {
    // Add delay before each request (except first attempt)
    if (attempt > 0) {
      const backoffDelay = calculateBackoffDelay(attempt - 1);
      console.log(`⏳ Raindrop API backing off for ${backoffDelay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
      await sleep(backoffDelay);
    } else {
      // Base delay for API politeness
      await sleep(RATE_LIMIT_CONFIG.baseDelay);
    }
    
    const response = await fetch(url, {
      timeout: RATE_LIMIT_CONFIG.batchTimeout,
      ...options,
      headers: {
        'Authorization': `Bearer ${process.env.RAINDROP_TOKEN}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : calculateBackoffDelay(attempt);
      
      console.log(`⏰ Raindrop rate limited. Waiting ${waitTime}ms before retry...`);
      await sleep(waitTime);
      
      if (attempt < maxRetries) {
        return makeRaindropAPICall(url, options, attempt + 1);
      } else {
        throw new Error(`Raindrop rate limited after ${maxRetries} retries`);
      }
    }
    
    // Handle other HTTP errors
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: `HTTP ${response.status}: ${response.statusText}` };
      }
      
      // Some errors are worth retrying (5xx, timeouts)
      const retryableStatuses = [500, 502, 503, 504];
      if (retryableStatuses.includes(response.status) && attempt < maxRetries) {
        console.log(`🔄 Raindrop retryable error ${response.status}, attempt ${attempt + 1}/${maxRetries + 1}`);
        return makeRaindropAPICall(url, options, attempt + 1);
      }
      
      throw new Error(`Raindrop API error (${response.status}): ${errorData.message || response.statusText}`);
    }
    
    return await response.json();
    
  } catch (error) {
    // Handle network errors with retry
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.type === 'request-timeout') {
      if (attempt < maxRetries) {
        console.log(`🌐 Raindrop network error, retrying... (attempt ${attempt + 1}/${maxRetries + 1})`);
        return makeRaindropAPICall(url, options, attempt + 1);
      }
    }
    
    console.error(`❌ Raindrop API call failed:`, error.message);
    throw error;
  }
}

/**
 * Get total count of bookmarks in Raindrop with retry logic
 */
async function getRaindropTotal() {
  try {
    console.log('🔢 Getting Raindrop total count...');
    
    const data = await makeRaindropAPICall('https://api.raindrop.io/rest/v1/raindrops/0?perpage=1');
    
    const total = data.count || 0;
    console.log(`📊 Total Raindrop bookmarks: ${total}`);
    return total;
    
  } catch (error) {
    console.error('❌ Error fetching raindrop count:', error.message);
    throw error;
  }
}

/**
 * Get all bookmarks from Raindrop with robust pagination and rate limiting
 */
async function getAllRaindrops(limit = 0) {
  console.log(`📚 Starting Raindrop fetch${limit > 0 ? ` (limit: ${limit})` : ''} with conservative rate limiting...`);
  
  let allItems = [];
  let page = 0;
  const perPage = RATE_LIMIT_CONFIG.pageSize;
  let hasMore = true;
  let requestCount = 0;
  let totalFetchTime = Date.now();
  
  try {
    // Handle small limit requests efficiently
    if (limit > 0 && limit <= perPage) {
      console.log(`🔄 Fetching ${limit} bookmarks (small batch mode)...`);
      
      const data = await makeRaindropAPICall(
        `https://api.raindrop.io/rest/v1/raindrops/0?page=0&perpage=${limit}`
      );
      
      const items = data.items || [];
      console.log(`✅ Fetched ${items.length} bookmarks successfully`);
      return items;
    }
    
    // Handle larger requests with pagination
    console.log('🔄 Starting paginated fetch...');
    
    while (hasMore && requestCount < RATE_LIMIT_CONFIG.maxPages && (limit === 0 || allItems.length < limit)) {
      const batchStartTime = Date.now();
      
      console.log(`📄 Fetching Raindrop page ${page + 1} (${allItems.length} items so far)...`);
      
      const data = await makeRaindropAPICall(
        `https://api.raindrop.io/rest/v1/raindrops/0?page=${page}&perpage=${perPage}`
      );
      
      const items = data.items || [];
      
      // Apply limit if specified
      if (limit > 0) {
        const remaining = limit - allItems.length;
        const itemsToAdd = items.slice(0, remaining);
        allItems = [...allItems, ...itemsToAdd];
      } else {
        allItems = [...allItems, ...items];
      }
      
      // Check if we need to continue
      hasMore = items.length === perPage && (limit === 0 || allItems.length < limit);
      page++;
      requestCount++;
      
      const batchTime = Date.now() - batchStartTime;
      console.log(`✅ Page ${page} complete: ${items.length} items in ${batchTime}ms (total: ${allItems.length})`);
      
      // Progress update every 5 pages
      if (requestCount % 5 === 0) {
        const elapsed = Math.round((Date.now() - totalFetchTime) / 1000);
        console.log(`🕐 Progress: ${allItems.length} items fetched in ${elapsed}s (${requestCount} API calls)`);
      }
      
      // Safety check
      if (requestCount >= RATE_LIMIT_CONFIG.maxPages) {
        console.warn(`⚠️ Reached maximum page limit (${RATE_LIMIT_CONFIG.maxPages}), stopping fetch`);
        break;
      }
    }
    
    const totalTime = Math.round((Date.now() - totalFetchTime) / 1000);
    const avgTimePerPage = requestCount > 0 ? Math.round(totalTime / requestCount * 1000) : 0;
    
    console.log(`🎉 Raindrop fetch complete: ${allItems.length} items in ${totalTime}s (${requestCount} API calls, ${avgTimePerPage}ms avg/page)`);
    
    // Final limit check
    if (limit > 0 && allItems.length > limit) {
      allItems = allItems.slice(0, limit);
      console.log(`✂️ Trimmed to requested limit: ${allItems.length} items`);
    }
    
    return allItems;
    
  } catch (error) {
    const partialTime = Math.round((Date.now() - totalFetchTime) / 1000);
    console.error(`❌ Raindrop fetch failed after ${partialTime}s with ${allItems.length} items retrieved:`, error.message);
    
    // Return partial results if we got some data
    if (allItems.length > 0) {
      console.log(`🔄 Returning ${allItems.length} partial results`);
      return allItems;
    }
    
    throw error;
  }
}

/**
 * Get recent raindrops with enhanced date filtering and error handling
 */
async function getRecentRaindrops(hours = 24) {
  console.log(`🔄 Fetching raindrops from the last ${hours} hours...`);
  
  try {
    // Calculate timestamp for filtering
    const timestamp = Date.now() - (hours * 60 * 60 * 1000);
    const dateStr = new Date(timestamp).toISOString();
    
    console.log(`📅 Looking for items created after: ${dateStr}`);
    
    // Use search endpoint with date filter
    const searchUrl = `https://api.raindrop.io/rest/v1/raindrops/0?search=created:>${dateStr}&perpage=${RATE_LIMIT_CONFIG.pageSize}`;
    
    const data = await makeRaindropAPICall(searchUrl);
    
    const items = data.items || [];
    
    console.log(`✅ Found ${items.length} recent bookmarks (last ${hours} hours)`);
    
    // Additional client-side filtering for extra safety
    const now = Date.now();
    const filteredItems = items.filter(item => {
      if (!item.created) return true; // Include if no creation date
      
      const itemDate = new Date(item.created).getTime();
      const ageHours = (now - itemDate) / (1000 * 60 * 60);
      
      return ageHours <= hours;
    });
    
    if (filteredItems.length !== items.length) {
      console.log(`🔍 Client-side filtering: ${filteredItems.length}/${items.length} items within ${hours}h window`);
    }
    
    return filteredItems;
    
  } catch (error) {
    console.error('❌ Error fetching recent raindrops:', error.message);
    
    // Fallback: try to get regular raindrops and filter client-side
    console.log('🔄 Falling back to regular fetch with client-side filtering...');
    
    try {
      const fallbackItems = await getAllRaindrops(100); // Get recent 100 items
      const now = Date.now();
      const hoursCutoff = hours * 60 * 60 * 1000;
      
      const recentItems = fallbackItems.filter(item => {
        if (!item.created) return false;
        const itemAge = now - new Date(item.created).getTime();
        return itemAge <= hoursCutoff;
      });
      
      console.log(`✅ Fallback filtering found ${recentItems.length} recent items`);
      return recentItems;
      
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError.message);
      throw error; // Throw original error
    }
  }
}

/**
 * Search raindrops with specific query and robust error handling
 */
async function searchRaindrops(query, limit = 50) {
  console.log(`🔍 Searching Raindrop for: "${query}" (limit: ${limit})`);
  
  try {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://api.raindrop.io/rest/v1/raindrops/0?search=${encodedQuery}&perpage=${Math.min(limit, RATE_LIMIT_CONFIG.pageSize)}`;
    
    const data = await makeRaindropAPICall(searchUrl);
    
    const items = data.items || [];
    console.log(`✅ Search found ${items.length} matching bookmarks`);
    
    return items;
    
  } catch (error) {
    console.error(`❌ Search failed for query "${query}":`, error.message);
    throw error;
  }
}

/**
 * Get raindrops from a specific collection
 */
async function getRaindropsFromCollection(collectionId, limit = 0) {
  console.log(`📁 Fetching raindrops from collection ${collectionId}${limit > 0 ? ` (limit: ${limit})` : ''}...`);
  
  try {
    let allItems = [];
    let page = 0;
    let hasMore = true;
    
    while (hasMore && (limit === 0 || allItems.length < limit)) {
      const currentLimit = limit > 0 ? Math.min(RATE_LIMIT_CONFIG.pageSize, limit - allItems.length) : RATE_LIMIT_CONFIG.pageSize;
      
      const data = await makeRaindropAPICall(
        `https://api.raindrop.io/rest/v1/raindrops/${collectionId}?page=${page}&perpage=${currentLimit}`
      );
      
      const items = data.items || [];
      allItems = [...allItems, ...items];
      
      hasMore = items.length === RATE_LIMIT_CONFIG.pageSize && (limit === 0 || allItems.length < limit);
      page++;
      
      console.log(`📄 Collection page ${page}: ${items.length} items (total: ${allItems.length})`);
    }
    
    console.log(`✅ Collection fetch complete: ${allItems.length} items from collection ${collectionId}`);
    return allItems;
    
  } catch (error) {
    console.error(`❌ Failed to fetch from collection ${collectionId}:`, error.message);
    throw error;
  }
}

/**
 * Health check for Raindrop API connectivity
 */
async function checkRaindropHealth() {
  console.log('🏥 Checking Raindrop API health...');
  
  try {
    const startTime = Date.now();
    
    // Simple API call to check connectivity
    const data = await makeRaindropAPICall('https://api.raindrop.io/rest/v1/user');
    
    const responseTime = Date.now() - startTime;
    
    console.log(`✅ Raindrop API healthy - Response time: ${responseTime}ms`);
    
    return {
      healthy: true,
      responseTime,
      user: data.user || null
    };
    
  } catch (error) {
    console.error('❌ Raindrop API health check failed:', error.message);
    
    return {
      healthy: false,
      error: error.message,
      responseTime: null
    };
  }
}

/**
 * Get Raindrop API rate limit status
 */
async function getRateLimitStatus() {
  console.log('📊 Checking Raindrop rate limit status...');
  
  try {
    // Make a minimal API call to check headers
    const response = await fetch('https://api.raindrop.io/rest/v1/raindrops/0?perpage=1', {
      headers: {
        'Authorization': `Bearer ${process.env.RAINDROP_TOKEN}`
      }
    });
    
    const rateLimitInfo = {
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      reset: response.headers.get('x-ratelimit-reset'),
      status: response.status
    };
    
    console.log('📈 Rate limit info:', rateLimitInfo);
    return rateLimitInfo;
    
  } catch (error) {
    console.error('❌ Failed to get rate limit status:', error.message);
    return null;
  }
}

/**
 * Utility function to validate Raindrop environment setup
 */
function validateRaindropConfig() {
  const issues = [];
  
  if (!process.env.RAINDROP_TOKEN) {
    issues.push('RAINDROP_TOKEN environment variable is missing');
  }
  
  if (process.env.RAINDROP_TOKEN && process.env.RAINDROP_TOKEN.length < 20) {
    issues.push('RAINDROP_TOKEN appears to be invalid (too short)');
  }
  
  if (issues.length > 0) {
    console.error('❌ Raindrop configuration issues:', issues);
    return { valid: false, issues };
  }
  
  console.log('✅ Raindrop configuration appears valid');
  return { valid: true, issues: [] };
}

// Export all functions
module.exports = {
  getRaindropTotal,
  getAllRaindrops,
  getRecentRaindrops,
  searchRaindrops,
  getRaindropsFromCollection,
  checkRaindropHealth,
  getRateLimitStatus,
  validateRaindropConfig
};