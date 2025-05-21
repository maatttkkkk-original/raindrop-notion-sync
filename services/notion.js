// File: services/notion.js
'use strict';

const fetch = require('node-fetch');

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/**
 * Helper function to normalize URLs for comparison
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
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
 * @param {string} title - Title to normalize
 * @returns {string} Normalized title
 */
function normalizeTitle(title) {
  return (title || '').trim().toLowerCase();
}

/**
 * Helper function to chunk arrays for batch processing
 * @param {Array} arr - Array to chunk
 * @param {number} size - Size of each chunk
 * @returns {Array} Array of chunks
 */
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Get all pages from the Notion database
 * @returns {Promise<Array>} Array of Notion pages
 */
async function getNotionPages() {
  const pages = [];
  let hasMore = true;
  let startCursor = null;
  let requestCount = 0;

  while (hasMore) {
    // Add delay to prevent rate limiting (after first request)
    if (requestCount > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    try {
      const res = await fetch(`${NOTION_API_URL}/databases/${process.env.NOTION_DB_ID}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(startCursor ? { start_cursor: startCursor } : {})
      });

      if (!res.ok) {
        // Handle rate limiting
        if (res.status === 429) {
          console.log('⏳ Rate limit hit, waiting 5 seconds...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue; // Try again without incrementing
        }
        
        const data = await res.json();
        throw new Error(`Notion API error: ${data.message || `Status ${res.status}`}`);
      }

      const data = await res.json();
      pages.push(...data.results);
      hasMore = data.has_more;
      startCursor = data.next_cursor;
      requestCount++;
      
      console.log(`Retrieved ${data.results.length} Notion pages (total so far: ${pages.length})`);
    } catch (error) {
      console.error('Error fetching Notion pages:', error);
      throw error;
    }
  }

  return pages;
}

/**
 * Get total count of pages in the Notion database
 * @returns {Promise<number>} Total number of pages
 */
async function getTotalNotionPages() {
  try {
    const pages = await getNotionPages();
    return pages.length;
  } catch (error) {
    console.error('Error getting Notion page count:', error);
    throw error;
  }
}

/**
 * Delete a Notion page (archive it)
 * @param {string} pageId - ID of the page to delete
 * @returns {Promise<boolean>} Success or failure
 */
async function deleteNotionPage(pageId) {
  try {
    const res = await fetch(`${NOTION_API_URL}/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        archived: true
      })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(`Failed to delete page: ${data.message || `Status ${res.status}`}`);
    }

    return true;
  } catch (error) {
    console.error(`Error deleting page ${pageId}:`, error);
    throw error;
  }
}

/**
 * Update a Notion page with raindrop data
 * @param {string} pageId - ID of the page to update
 * @param {Object} item - Raindrop data
 * @returns {Promise<boolean>} Success or failure
 */
async function updateNotionPage(pageId, item) {
  const page = {
    properties: {
      Name: { title: [{ text: { content: item.title || 'Untitled' } }] },
      URL: { url: item.link },
      Tags: {
        multi_select: (item.tags || []).map(tag => ({ name: tag }))
      }
    }
  };

  try {
    const res = await fetch(`${NOTION_API_URL}/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(page)
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(`Failed to update page: ${data.message || `Status ${res.status}`}`);
    }

    // Update the image if needed (in a non-blocking way)
    const imageUrl = item.cover || 
                    (item.media && item.media.length > 0 && item.media[0] && item.media[0].link) || 
                    (item.preview && item.preview.length > 0 && item.preview[0]);
                    
    if (imageUrl) {
      // Add a small delay to avoid overwhelming the Notion API
      setTimeout(async () => {
        try {
          await updateNotionPageImage(pageId, imageUrl);
        } catch (imageError) {
          console.warn(`Warning: Could not update image for page ${pageId}:`, imageError.message);
        }
      }, 500);
    }

    return true;
  } catch (error) {
    console.error(`Error updating page ${pageId}:`, error);
    throw error;
  }
}

/**
 * Update the image block of a Notion page
 * @param {string} pageId - ID of the page
 * @param {string} imageUrl - URL of the image
 * @returns {Promise<boolean>} Success or failure
 */
async function updateNotionPageImage(pageId, imageUrl) {
  try {
    // Validate the image URL before proceeding
    if (!imageUrl || typeof imageUrl !== 'string') {
      console.log(`Skipping image update for page ${pageId}: Invalid image URL`);
      return false;
    }
    
    // Check if the URL is properly formatted and has a valid protocol
    try {
      const url = new URL(imageUrl);
      // Notion only supports https and http protocols for external images
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        console.log(`Skipping image update for page ${pageId}: Unsupported protocol ${url.protocol}`);
        return false;
      }
    } catch (e) {
      console.log(`Skipping image update for page ${pageId}: Invalid URL format`);
      return false;
    }
    
    // Additional validation: check common image extensions
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const hasValidExtension = validExtensions.some(ext => 
      imageUrl.toLowerCase().endsWith(ext) || imageUrl.toLowerCase().includes(ext + '?')
    );
    
    // If no valid extension, check if it's likely a dynamic image URL
    if (!hasValidExtension && 
        !imageUrl.includes('image') && 
        !imageUrl.includes('img') &&
        !imageUrl.includes('thumbnail') &&
        !imageUrl.includes('asset')) {
      console.log(`Skipping image update for page ${pageId}: URL doesn't appear to be an image: ${imageUrl}`);
      return false;
    }
    
    // First check if the page already has an image block
    const blocksRes = await fetch(`${NOTION_API_URL}/blocks/${pageId}/children`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION
      }
    });
    
    if (!blocksRes.ok) {
      throw new Error(`Failed to get blocks: Status ${blocksRes.status}`);
    }
    
    const blocksData = await blocksRes.json();
    let imageBlockExists = false;
    let imageBlockId = null;
    
    if (blocksData.results) {
      for (const block of blocksData.results) {
        if (block.type === 'image') {
          imageBlockExists = true;
          imageBlockId = block.id;
          break;
        }
      }
    }
    
    if (imageBlockExists && imageBlockId) {
      // Update existing image block
      const updateRes = await fetch(`${NOTION_API_URL}/blocks/${imageBlockId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: {
            type: 'external',
            external: { url: imageUrl }
          }
        })
      });
      
      if (!updateRes.ok) {
        // Get more detailed error information
        const errorData = await updateRes.json().catch(() => ({ message: 'Unknown error' }));
        console.log(`Image update error details:`, JSON.stringify(errorData));
        throw new Error(`Failed to update image: Status ${updateRes.status}, Message: ${errorData.message || 'Unknown error'}`);
      }
      
      return true;
    } else {
      // Create new image block
      const createRes = await fetch(`${NOTION_API_URL}/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
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
      
      if (!createRes.ok) {
        // Get more detailed error information
        const errorData = await createRes.json().catch(() => ({ message: 'Unknown error' }));
        console.log(`Image creation error details:`, JSON.stringify(errorData));
        throw new Error(`Failed to create image: Status ${createRes.status}, Message: ${errorData.message || 'Unknown error'}`);
      }
      
      return true;
    }
  } catch (error) {
    console.error(`Error updating image for page ${pageId}:`, error);
    return false; // Image failure shouldn't fail the whole update
  }
}

/**
 * Create a new Notion page from raindrop data
 * @param {Object} item - Raindrop data
 * @returns {Promise<Object>} Result with success status and pageId
 */
async function createNotionPage(item) {
  console.log(`📝 Creating: "${item.title}"`);

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

  try {
    const res = await fetch(`${NOTION_API_URL}/pages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(page)
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(`Failed to create page: ${data.message || `Status ${res.status}`}`);
    }
    
    const createdPage = await res.json();
    const pageId = createdPage.id;
    
    // Add image if available (in a non-blocking way)
    const imageUrl = item.cover || 
                    (item.media && item.media.length > 0 && item.media[0] && item.media[0].link) || 
                    (item.preview && item.preview.length > 0 && item.preview[0]);
                    
    if (imageUrl) {
      // Add a small delay to avoid overwhelming the Notion API
      setTimeout(async () => {
        try {
          await updateNotionPageImage(pageId, imageUrl);
        } catch (imageError) {
          console.warn(`Warning: Could not add image to page ${pageId}:`, imageError.message);
        }
      }, 500);
    }

    return { success: true, pageId };
  } catch (error) {
    console.error(`Error creating page for "${item.title}":`, error);
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