/**
 * IndexedDB cache manager for animation frames
 * Stores pre-rendered canvas frames to avoid regeneration on page reload
 */

interface CachedFrame {
    key: string;
    imageData: Blob; // Canvas as PNG blob
    width: number;
    height: number;
    timestamp: number; // For cache invalidation
}

const DB_NAME = 'florr_animation_cache';
const DB_VERSION = 1;
const STORE_NAME = 'frames';
const CACHE_VERSION = 1; // Increment to invalidate all cached frames

export class AnimationCache {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;
    private isSupported: boolean = true;

    constructor() {
        // Check if IndexedDB is supported
        if (typeof indexedDB === 'undefined') {
            console.warn('[AnimationCache] IndexedDB not supported, caching disabled');
            this.isSupported = false;
            this.initPromise = Promise.resolve();
        } else {
            this.initPromise = this.initialize();
        }
    }

    private async initialize(): Promise<void> {
        if (!this.isSupported) {
            return;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('[AnimationCache] Failed to open database:', request.error);
                this.isSupported = false;
                resolve(); // Don't reject, just disable caching
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[AnimationCache] Database opened successfully');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                // Create object store if it doesn't exist
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                    objectStore.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('[AnimationCache] Object store created');
                }
            };
        });
    }

    public async waitForInit(): Promise<void> {
        if (this.initPromise) {
            await this.initPromise;
        }
    }

    /**
     * Store a canvas frame in IndexedDB
     */
    public async storeFrame(key: string, canvas: HTMLCanvasElement): Promise<void> {
        if (!this.isSupported || !this.db) {
            return;
        }

        try {
            await this.waitForInit();
            if (!this.db) return;

            // Convert canvas to blob
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to convert canvas to blob'));
                    }
                }, 'image/png');
            });

            const frame: CachedFrame = {
                key: `${CACHE_VERSION}_${key}`, // Include version in key for cache invalidation
                imageData: blob,
                width: canvas.width,
                height: canvas.height,
                timestamp: Date.now()
            };

            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            await new Promise<void>((resolve, reject) => {
                const request = store.put(frame);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            if (Math.random() < 0.01) { // Log occasionally
                console.log(`[AnimationCache] Stored frame: ${key}`);
            }
        } catch (error) {
            console.warn(`[AnimationCache] Failed to store frame ${key}:`, error);
        }
    }

    /**
     * Store multiple frames in a batch
     */
    public async storeFrames(frames: Array<{ key: string; canvas: HTMLCanvasElement }>): Promise<void> {
        if (!this.isSupported || !this.db) {
            return;
        }

        try {
            await this.waitForInit();
            if (!this.db) return;

            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const promises = frames.map(async ({ key, canvas }) => {
                try {
                    const blob = await new Promise<Blob>((resolve, reject) => {
                        canvas.toBlob((blob) => {
                            if (blob) {
                                resolve(blob);
                            } else {
                                reject(new Error('Failed to convert canvas to blob'));
                            }
                        }, 'image/png');
                    });

                    const frame: CachedFrame = {
                        key: `${CACHE_VERSION}_${key}`,
                        imageData: blob,
                        width: canvas.width,
                        height: canvas.height,
                        timestamp: Date.now()
                    };

                    return new Promise<void>((resolve, reject) => {
                        const request = store.put(frame);
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                } catch (error) {
                    console.warn(`[AnimationCache] Failed to store frame ${key}:`, error);
                    return Promise.resolve();
                }
            });

            await Promise.all(promises);
            console.log(`[AnimationCache] Stored ${frames.length} frames in batch`);
        } catch (error) {
            console.warn('[AnimationCache] Failed to store frames batch:', error);
        }
    }

    /**
     * Retrieve a canvas frame from IndexedDB
     */
    public async getFrame(key: string): Promise<HTMLCanvasElement | null> {
        if (!this.isSupported || !this.db) {
            return null;
        }

        try {
            await this.waitForInit();
            if (!this.db) return null;

            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            
            const frame = await new Promise<CachedFrame | undefined>((resolve, reject) => {
                const request = store.get(`${CACHE_VERSION}_${key}`);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            if (!frame) {
                return null;
            }

            // Convert blob back to canvas
            const imageBitmap = await createImageBitmap(frame.imageData);
            const canvas = document.createElement('canvas');
            canvas.width = frame.width;
            canvas.height = frame.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                imageBitmap.close();
                return null;
            }

            ctx.drawImage(imageBitmap, 0, 0);
            imageBitmap.close();

            if (Math.random() < 0.01) { // Log occasionally
                console.log(`[AnimationCache] Retrieved frame: ${key}`);
            }

            return canvas;
        } catch (error) {
            console.warn(`[AnimationCache] Failed to retrieve frame ${key}:`, error);
            return null;
        }
    }

    /**
     * Retrieve multiple frames in a batch
     */
    public async getFrames(keys: string[]): Promise<Map<string, HTMLCanvasElement>> {
        const result = new Map<string, HTMLCanvasElement>();
        
        if (!this.isSupported || !this.db) {
            return result;
        }

        try {
            await this.waitForInit();
            if (!this.db) return result;

            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);

            const promises = keys.map(async (key) => {
                try {
                    const frame = await new Promise<CachedFrame | undefined>((resolve, reject) => {
                        const request = store.get(`${CACHE_VERSION}_${key}`);
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });

                    if (!frame) {
                        return null;
                    }

                    const imageBitmap = await createImageBitmap(frame.imageData);
                    const canvas = document.createElement('canvas');
                    canvas.width = frame.width;
                    canvas.height = frame.height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        imageBitmap.close();
                        return null;
                    }

                    ctx.drawImage(imageBitmap, 0, 0);
                    imageBitmap.close();

                    return { key, canvas };
                } catch (error) {
                    console.warn(`[AnimationCache] Failed to retrieve frame ${key}:`, error);
                    return null;
                }
            });

            const results = await Promise.all(promises);
            results.forEach((item) => {
                if (item) {
                    result.set(item.key, item.canvas);
                }
            });

            if (result.size > 0) {
                console.log(`[AnimationCache] Retrieved ${result.size}/${keys.length} frames from cache`);
            }

            return result;
        } catch (error) {
            console.warn('[AnimationCache] Failed to retrieve frames batch:', error);
            return result;
        }
    }

    /**
     * Check if a frame exists in cache
     */
    public async hasFrame(key: string): Promise<boolean> {
        if (!this.isSupported || !this.db) {
            return false;
        }

        try {
            await this.waitForInit();
            if (!this.db) return false;

            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            
            const frame = await new Promise<CachedFrame | undefined>((resolve, reject) => {
                const request = store.get(`${CACHE_VERSION}_${key}`);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            return !!frame;
        } catch (error) {
            return false;
        }
    }

    /**
     * Clear all cached frames
     */
    public async clearCache(): Promise<void> {
        if (!this.isSupported || !this.db) {
            return;
        }

        try {
            await this.waitForInit();
            if (!this.db) return;

            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            await new Promise<void>((resolve, reject) => {
                const request = store.clear();
                request.onsuccess = () => {
                    console.log('[AnimationCache] Cache cleared');
                    resolve();
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('[AnimationCache] Failed to clear cache:', error);
        }
    }

    /**
     * Get cache size (approximate)
     */
    public async getCacheSize(): Promise<number> {
        if (!this.isSupported || !this.db) {
            return 0;
        }

        try {
            await this.waitForInit();
            if (!this.db) return 0;

            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            
            const count = await new Promise<number>((resolve, reject) => {
                const request = store.count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            return count;
        } catch (error) {
            return 0;
        }
    }
}

// Singleton instance
let animationCacheInstance: AnimationCache | null = null;

export function getAnimationCache(): AnimationCache {
    if (!animationCacheInstance) {
        animationCacheInstance = new AnimationCache();
    }
    return animationCacheInstance;
}

