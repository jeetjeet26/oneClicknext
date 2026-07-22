// WordPress REST API client for deployment operations

import { WPCredentials, WPPage, WPMedia, BlueprintSection } from '../_shared/types.ts';
import { blueprintToGutenbergContent } from './blueprint-parser.ts';

export class WordPressClient {
  private apiUrl: string;
  private authHeader: string;

  constructor(credentials: WPCredentials) {
    this.apiUrl = credentials.api_url.replace(/\/$/, '');
    const encodedAuth = btoa(`${credentials.username}:${credentials.app_password}`);
    this.authHeader = `Basic ${encodedAuth}`;
  }

  /**
   * Test connection to WordPress REST API
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/wp-json/`, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader,
        },
      });
      return response.ok;
    } catch (error) {
      console.error('WordPress connection test failed:', error);
      return false;
    }
  }

  /**
   * Upload an image file to WordPress media library
   */
  async uploadMedia(
    fileUrl: string,
    altText: string,
  ): Promise<WPMedia> {
    try {
      // Fetch the file from the URL
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        throw new Error(`Failed to fetch file from ${fileUrl}`);
      }

      const arrayBuffer = await fileResponse.arrayBuffer();
      const fileName = fileUrl.split('/').pop() || 'image.jpg';

      // Upload to WordPress
      const formData = new FormData();
      formData.append('file', new Blob([arrayBuffer], { type: fileResponse.headers.get('content-type') || 'image/jpeg' }), fileName);

      const uploadResponse = await fetch(`${this.apiUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
        },
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Media upload failed: ${uploadResponse.statusText}`);
      }

      const mediaData = await uploadResponse.json();
      return {
        id: mediaData.id,
        source_url: mediaData.source_url,
        media_details: mediaData.media_details || {},
      };
    } catch (error) {
      console.error(`Error uploading media from ${fileUrl}:`, error);
      throw error;
    }
  }

  /**
   * Create or update a WordPress page with Gutenberg content
   */
  async createOrUpdatePage(
    pageTitle: string,
    pageSlug: string,
    sections: BlueprintSection[],
    existingPageId?: number,
  ): Promise<WPPage> {
    try {
      const gutenbergContent = blueprintToGutenbergContent(sections);

      const pageData = {
        title: pageTitle,
        slug: pageSlug,
        content: gutenbergContent,
        status: 'publish',
        type: 'page',
      };

      const method = existingPageId ? 'PUT' : 'POST';
      const endpoint = existingPageId
        ? `${this.apiUrl}/wp-json/wp/v2/pages/${existingPageId}`
        : `${this.apiUrl}/wp-json/wp/v2/pages`;

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pageData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Page ${method === 'POST' ? 'creation' : 'update'} failed: ${JSON.stringify(errorData)}`);
      }

      const pageResponse = await response.json();
      return {
        id: pageResponse.id,
        slug: pageResponse.slug,
        title: { rendered: pageResponse.title.raw || pageResponse.title },
        content: { raw: pageResponse.content.raw || '' },
        status: pageResponse.status,
      };
    } catch (error) {
      console.error(`Error creating/updating page "${pageTitle}":`, error);
      throw error;
    }
  }

  /**
   * Get a page by slug
   */
  async getPageBySlug(slug: string): Promise<WPPage | null> {
    try {
      const response = await fetch(`${this.apiUrl}/wp-json/wp/v2/pages?slug=${slug}&per_page=1`, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch page with slug "${slug}"`);
      }

      const pages = await response.json();
      if (pages.length === 0) {
        return null;
      }

      const page = pages[0];
      return {
        id: page.id,
        slug: page.slug,
        title: { rendered: page.title.rendered },
        content: { raw: page.content.raw },
        status: page.status,
      };
    } catch (error) {
      console.error(`Error fetching page with slug "${slug}":`, error);
      throw error;
    }
  }

  /**
   * Delete a page by ID
   */
  async deletePage(pageId: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/wp-json/wp/v2/pages/${pageId}?force=true`, {
        method: 'DELETE',
        headers: {
          'Authorization': this.authHeader,
        },
      });

      return response.ok;
    } catch (error) {
      console.error(`Error deleting page with ID ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Set the homepage (front page) in WordPress settings
   */
  async setHomepage(pageId: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/wp-json/wp/v2/settings`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page_on_front: pageId,
          show_on_front: 'page',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Setting homepage failed: ${JSON.stringify(errorData)}`);
      }

      return true;
    } catch (error) {
      console.error('Error setting homepage:', error);
      throw error;
    }
  }

  /**
   * Update site title and tagline
   */
  async updateSiteSettings(siteTitle: string, tagline: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/wp-json/wp/v2/settings`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: siteTitle,
          description: tagline,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Setting site details failed: ${JSON.stringify(errorData)}`);
      }

      return true;
    } catch (error) {
      console.error('Error updating site settings:', error);
      throw error;
    }
  }

  /**
   * Create a navigation menu with items
   * NOTE: Requires WP REST API Menus plugin
   */
  async createNavigationMenu(
    menuName: string,
    menuItems: Array<{ title: string; url: string; pageId?: number }>,
  ): Promise<number> {
    try {
      // Create menu
      const menuResponse = await fetch(`${this.apiUrl}/wp-json/wp/v2/menus`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: menuName,
          description: `Navigation menu for ${menuName}`,
        }),
      });

      if (!menuResponse.ok) {
        const errorData = await menuResponse.json();
        throw new Error(`Menu creation failed: ${JSON.stringify(errorData)}`);
      }

      const menu = await menuResponse.json();
      const menuId = menu.id;

      // Add menu items
      for (let index = 0; index < menuItems.length; index++) {
        const item = menuItems[index];
        const itemData: Record<string, unknown> = {
          title: item.title,
          url: item.url,
          menu_order: index + 1,
          parent: 0,
        };

        if (item.pageId) {
          itemData.object = 'page';
          itemData.object_id = item.pageId;
        } else {
          itemData.type = 'custom';
        }

        await fetch(`${this.apiUrl}/wp-json/wp/v2/menu-items`, {
          method: 'POST',
          headers: {
            'Authorization': this.authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...itemData,
            menus: menuId,
          }),
        });
      }

      return menuId;
    } catch (error) {
      console.error('Error creating navigation menu:', error);
      throw error;
    }
  }

  /**
   * Get all pages from the site
   */
  async getAllPages(): Promise<WPPage[]> {
    try {
      const pages: WPPage[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await fetch(
          `${this.apiUrl}/wp-json/wp/v2/pages?per_page=100&page=${page}&status=publish,draft`,
          {
            method: 'GET',
            headers: {
              'Authorization': this.authHeader,
            },
          },
        );

        if (!response.ok) {
          break;
        }

        const pageData = await response.json();
        if (pageData.length === 0) {
          hasMore = false;
        } else {
          pages.push(...pageData.map((p: Record<string, unknown>) => ({
            id: p.id as number,
            slug: p.slug as string,
            title: { rendered: (p.title as Record<string, unknown>).rendered as string },
            content: { raw: (p.content as Record<string, unknown>).raw as string },
            status: p.status as string,
          })));
          page++;
        }
      }

      return pages;
    } catch (error) {
      console.error('Error fetching all pages:', error);
      throw error;
    }
  }

  /**
   * Get WP instance info (version, theme, etc)
   */
  async getInstanceInfo(): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${this.apiUrl}/wp-json/`, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to get WordPress instance info');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting WordPress instance info:', error);
      throw error;
    }
  }

  /**
   * Delete all pages (except home)
   */
  async deleteAllPages(homePageId: number): Promise<number> {
    try {
      const allPages = await this.getAllPages();
      let deletedCount = 0;

      for (const page of allPages) {
        if (page.id !== homePageId && page.slug !== 'home') {
          try {
            await this.deletePage(page.id);
            deletedCount++;
          } catch (err) {
            console.warn(`Failed to delete page ${page.id}:`, err);
          }
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('Error deleting all pages:', error);
      throw error;
    }
  }
}
