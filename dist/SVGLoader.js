"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SVGLoader = void 0;
class SVGLoader {
    constructor() {
        this.svgCache = new Map();
    }
    async loadSVG(path) {
        try {
            // Check cache first
            if (this.svgCache.has(path)) {
                return this.svgCache.get(path).cloneNode(true);
            }
            // Create a default SVG if loading fails
            const defaultSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            defaultSVG.setAttribute("width", "100");
            defaultSVG.setAttribute("height", "100");
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("width", "100");
            rect.setAttribute("height", "100");
            rect.setAttribute("fill", "#666");
            defaultSVG.appendChild(rect);
            try {
                const response = await fetch(path);
                if (!response.ok)
                    throw new Error(`HTTP error! status: ${response.status}`);
                const text = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, "image/svg+xml");
                const svg = doc.querySelector('svg');
                if (svg instanceof SVGElement) {
                    this.svgCache.set(path, svg);
                    return svg.cloneNode(true);
                }
                throw new Error('Invalid SVG file');
            }
            catch (error) {
                console.warn(`Failed to load SVG from ${path}, using default:`, error);
                this.svgCache.set(path, defaultSVG);
                return defaultSVG.cloneNode(true);
            }
        }
        catch (error) {
            console.error('Error in loadSVG:', error);
            return document.createElementNS("http://www.w3.org/2000/svg", "svg");
        }
    }
    renderSVG(svgPath, container) {
        this.loadSVG(svgPath)
            .then(svg => {
            container.innerHTML = '';
            container.appendChild(svg);
        })
            .catch(error => {
            console.error('Error rendering SVG:', error);
        });
    }
}
exports.SVGLoader = SVGLoader;
