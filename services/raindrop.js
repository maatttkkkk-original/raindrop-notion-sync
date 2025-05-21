// File: services/raindrop.js
'use strict';

const fetch = require('node-fetch');

/**
 * Get total count of bookmarks in Raindrop
 * @returns {Promise<number>} Total number of raindrops
 */
async function getRaindropTotal() {
  try {
    const res = await fetch('https://api.raindrop.io/rest/v1/raindrops/0?perpage=1', {
      headers: {
        Authorization: `Bearer ${process.env.RAINDROP_TOKEN}`
      }
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Raindrop API error (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    return data.count || 0;
  } catch (error) {
    console.error('Error fetching raindrop count:', error);
    throw error;
  }
}

/**
 * Get all bookmarks from Raindrop with optional limit
 * @param {number} limit - Maximum number of bookmarks to fetch (0 for all)
 * @returns {Promise<Array>} Array of raindrop bookmarks
 */
async function getAllRaindrops(limit = 0) {
  let allItems = [];
  let page = 0;
  const perPage = 50; // Maximum allowed by Raindrop API
  let hasMore = true;
  let pageCount = 0;
  const MAX_PAGES = 30; // Safety limit to prevent infinite loops
  
  // For dev testing with small limit
  if (limit > 0 && limit <= perPage) {
    console.log(`🔄 Fetching ${limit} bookmarks (dev mode)...`);
    try {
      const res = await fetch(`https://api.raindrop.io/rest/v1/raindrops/0?page=0&perpage=${limit}`, {
        headers: {
          Authorization: `Bearer ${process.env.RAINDROP_TOKEN}`
        }
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Raindrop API error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      console.log(`📚 Total bookmarks fetched: ${data.items.length}`);
      return data.items || [];
    } catch (error) {
      console.error('Error fetching raindrops:', error);
      throw error;
    }
  }

  // For regular syncs, paginate as needed
  console.log('🔄 Fetching bookmarks from Raindrop...');

  while (hasMore && pageCount < MAX_PAGES && (limit === 0 || allItems.length < limit)) {
    console.log(`📑 Fetching page ${page + 1}...`);
    try {
      // Add delay to prevent rate limiting (after first page)
      if (pageCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      const res = await fetch(`https://api.raindrop.io/rest/v1/raindrops/0?page=${page}&perpage=${perPage}`, {
        headers: {
          Authorization: `Bearer ${process.env.RAINDROP_TOKEN}`
        }
      });

      if (!res.ok) {
        // Handle rate limiting
        if (res.status === 429) {
          console.log('⏳ Rate limit hit, waiting 5 seconds...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue; // Try again without incrementing page
        }
        
        const errorText = await res.text();
        throw new Error(`Raindrop API error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      const items = data.items || [];
      
      // If we have a limit, only add up to the limit
      if (limit > 0) {
        const remaining = limit - allItems.length;
        allItems = [...allItems, ...items.slice(0, remaining)];
      } else {
        allItems = [...allItems, ...items];
      }
      
      // Check if we need to fetch more pages
      hasMore = items.length === perPage && (limit === 0 || allItems.length < limit);
      page++;
      pageCount++;

      // Log progress
      console.log(`✅ Retrieved ${items.length} bookmarks (total so far: ${allItems.length}${limit > 0 ? ` of ${limit}` : ''})`);
    } catch (error) {
      console.error('Error fetching raindrops:', error);
      throw error;
    }
  }

  console.log(`📚 Total bookmarks fetched: ${allItems.length}`);
  
  // If we have a limit but haven't hit it yet (due to MAX_PAGES), slice the result
  if (limit > 0 && allItems.length > limit) {
    return allItems.slice(0, limit);
  }
  
  return allItems;
}

/**
 * Get raindrops that have been created in the last 24 hours (or custom timeframe)
 * @param {number} hours - Hours to look back (default: 24)
 * @returns {Promise<Array>} Array of recent raindrop bookmarks
 */
async function getRecentRaindrops(hours = 24) {
  const timestamp = Date.now() - (hours * 60 * 60 * 1000);
  const dateStr = new Date(timestamp).toISOString();
  
  console.log(`🔄 Fetching raindrops created in the last ${hours} hours...`);
  
  try {
    const res = await fetch(`https://api.raindrop.io/rest/v1/raindrops/0?search=created:>${dateStr}`, {
      headers: {
        Authorization: `Bearer ${process.env.RAINDROP_TOKEN}`
      }
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Raindrop API error (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    const items = data.items || [];
    
    console.log(`📚 Found ${items.length} recently added bookmarks`);
    return items;
  } catch (error) {
    console.error('Error fetching recent raindrops:', error);
    throw error;
  }
}

// Export all functions
module.exports = {
  getRaindropTotal,
  getAllRaindrops,
  getRecentRaindrops
};