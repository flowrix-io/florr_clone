export class ShaderManager {
    private shadersEnabled: boolean = false;
    private shadowScript: HTMLScriptElement | null = null;
    private shadowProperties: any = {};

    constructor() {
        this.loadShaderSettings();
    }

    /**
     * Load shader settings from localStorage
     */
    private loadShaderSettings(): void {
        const saved = localStorage.getItem('shadersEnabled');
        this.shadersEnabled = saved ? JSON.parse(saved) : false;
    }

    /**
     * Save shader settings to localStorage
     */
    private saveShaderSettings(): void {
        localStorage.setItem('shadersEnabled', JSON.stringify(this.shadersEnabled));
    }

    /**
     * Enable or disable shaders
     */
    public setShadersEnabled(enabled: boolean): void {
        this.shadersEnabled = enabled;
        this.saveShaderSettings();
        
        if (enabled) {
            this.loadShaders();
        } else {
            this.unloadShaders();
        }
    }

    /**
     * Check if shaders are enabled
     */
    public areShadersEnabled(): boolean {
        return this.shadersEnabled;
    }

    /**
     * Load shadow shader script
     */
    private loadShaders(): void {
        if (this.shadowScript) {
            return; // Already loaded
        }

        // Create and inject the shadow shader script
        this.shadowScript = document.createElement('script');
        this.shadowScript.textContent = this.getShadowShaderCode();
        document.head.appendChild(this.shadowScript);

        console.log('[ShaderManager] Shaders loaded');
    }

    /**
     * Unload shadow shader script
     */
    private unloadShaders(): void {
        if (this.shadowScript) {
            this.shadowScript.remove();
            this.shadowScript = null;
        }

        // Reset shadow properties
        this.shadowProperties = {};
        this.resetCanvasShadowProperties();

        console.log('[ShaderManager] Shaders unloaded');
    }

    /**
     * Reset canvas shadow properties to default
     */
    private resetCanvasShadowProperties(): void {
        // Reset shadow properties on all canvas contexts
        const canvases = document.querySelectorAll('canvas');
        canvases.forEach(canvas => {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.shadowBlur = 0;
                ctx.shadowColor = 'transparent';
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            }
        });
    }

    /**
     * Get the shadow shader code (simplified version of shadow.js with fixed values)
     */
    private getShadowShaderCode(): string {
        return `
(function() {
    "use strict";
    
    const shadowProperties = {
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowBlur: 30,
        shadowColor: "#ffffff",
        shadowColorInherit: false,
        shadowOffscreenCanvas: false
    };
    
    function HandleColor(self, color, isStroke, isOffscreen) {
        if (isOffscreen && !shadowProperties.shadowOffscreenCanvas) return color;
        for (let key in shadowProperties) self[key] = shadowProperties[key];
        if (shadowProperties.shadowColorInherit) self.shadowColor = color;
        return color;
    }
    
    // Override CanvasRenderingContext2D fillStyle and strokeStyle
    const {
        set: _setFillStyle,
        get: _getFillStyle
    } = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'fillStyle');
    
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'fillStyle', {
        get() {
            return _getFillStyle.call(this);
        },
        set(v) {
            _setFillStyle.call(this, HandleColor(this, v, false, false));
        }
    });
    
    const {
        set: _setStrokeStyle,
        get: _getStrokeStyle
    } = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'strokeStyle');
    
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'strokeStyle', {
        get() {
            return _getStrokeStyle.call(this);
        },
        set(v) {
            _setStrokeStyle.call(this, HandleColor(this, v, true, false));
        }
    });
    
    // Override OffscreenCanvasRenderingContext2D fillStyle and strokeStyle
    const {
        set: _setFillStyleOffscreen,
        get: _getFillStyleOffscreen
    } = Object.getOwnPropertyDescriptor(OffscreenCanvasRenderingContext2D.prototype, 'fillStyle');
    
    Object.defineProperty(OffscreenCanvasRenderingContext2D.prototype, 'fillStyle', {
        get() {
            return _getFillStyleOffscreen.call(this);
        },
        set(v) {
            _setFillStyleOffscreen.call(this, HandleColor(this, v, false, true));
        }
    });
    
    const {
        set: _setStrokeStyleOffscreen,
        get: _getStrokeStyleOffscreen
    } = Object.getOwnPropertyDescriptor(OffscreenCanvasRenderingContext2D.prototype, 'strokeStyle');
    
    Object.defineProperty(OffscreenCanvasRenderingContext2D.prototype, 'strokeStyle', {
        get() {
            return _getStrokeStyleOffscreen.call(this);
        },
        set(v) {
            _setStrokeStyleOffscreen.call(this, HandleColor(this, v, true, true));
        }
    });
    
    // Make shadowProperties available globally for updates
    window.shadowProperties = shadowProperties;
})();
        `;
    }

}

// Extend Window interface to include shadowProperties
declare global {
    interface Window {
        shadowProperties?: any;
    }
}
