/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 375:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   PETAL_CONFIG: () => (/* binding */ PETAL_CONFIG),
/* harmony export */   q: () => (/* binding */ getPetalStats),
/* harmony export */   tn: () => (/* binding */ getAllPetalTypes)
/* harmony export */ });
/* unused harmony export getPetalRarities */
const PETAL_CONFIG = {
    basic: {
        common: {
            name: "Basic Petal",
            damage: 10,
            health: 10,
            size: 2.0,
            speed: 1.0,
            cooldown: 1200, // 10 seconds
            knockback: 1,
            description: "A simple petal that provides basic protection",
            color: "#90EE90",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        uncommon: {
            name: "Enhanced Basic Petal",
            damage: 30,
            health: 30,
            size: 2.0,
            speed: 1.0,
            cooldown: 1200, // 9 seconds
            knockback: 1,
            description: "An improved basic petal with better stats",
            color: "#32CD32",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        rare: {
            name: "Superior Basic Petal",
            damage: 90,
            health: 90,
            size: 2.0,
            speed: 1.0,
            cooldown: 1200, // 8 seconds
            knockback: 1,
            description: "A superior basic petal with enhanced capabilities",
            color: "#228B22",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        epic: {
            name: "Elite Basic Petal",
            damage: 270,
            health: 270,
            size: 2.0,
            speed: 1.0,
            cooldown: 1200, // 7 seconds
            knockback: 1,
            description: "An elite basic petal with impressive power",
            color: "#006400",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        legendary: {
            name: "Legendary Basic Petal",
            damage: 810,
            health: 810,
            size: 2.0,
            speed: 1.0,
            cooldown: 1200, // 6 seconds
            knockback: 1,
            description: "A legendary basic petal of immense strength",
            color: "#8B4513",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        mythic: {
            name: "Mythic Basic Petal",
            damage: 2430,
            health: 2430,
            size: 2.0,
            speed: 1.0,
            cooldown: 1200, // 5 seconds
            knockback: 1,
            description: "A mythic basic petal with otherworldly power",
            color: "#4B0082",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        ultra: {
            name: "Ultra Basic Petal",
            damage: 7290,
            health: 7290,
            size: 2.0,
            speed: 1.0,
            cooldown: 1200, // 4 seconds
            knockback: 1,
            description: "An ultra basic petal with cosmic power",
            color: "#de1f65",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        super: {
            name: "Super Basic Petal",
            damage: 21870,
            health: 21870,
            size: 2.0,
            speed: 1.0,
            cooldown: 1200, // 3 seconds
            knockback: 1,
            description: "A super basic petal with divine energy",
            color: "#2bffa4",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        unique: {
            name: "Unique Basic Petal",
            damage: 65610,
            health: 65610,
            size: 2.0,
            speed: 1.0,
            cooldown: 1200, // 2 seconds
            knockback: 1,
            description: "A unique basic petal of ultimate power",
            color: "#bf00ff",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        }
    },
    rose: {
        common: {
            name: "Rose Petal",
            damage: 5,
            health: 5,
            size: 0.9,
            speed: 1.0,
            cooldown: 1500, // 8 seconds
            knockback: 1,
            description: "A thorny petal that deals extra damage",
            color: "#FF69B4",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        uncommon: {
            name: "Blood Rose Petal",
            damage: 15,
            health: 15,
            size: 1.0,
            speed: 1.0,
            cooldown: 1500, // 7 seconds
            knockback: 1,
            description: "A crimson petal with sharp thorns",
            color: "#DC143C",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        rare: {
            name: "Royal Rose Petal",
            damage: 45,
            health: 45,
            size: 1.1,
            speed: 1.0,
            cooldown: 1500, // 6 seconds
            knockback: 1,
            description: "A majestic rose petal fit for royalty",
            color: "#8B0000",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        epic: {
            name: "Divine Rose Petal",
            damage: 135,
            health: 135,
            size: 1.2,
            speed: 1.0,
            cooldown: 1500, // 5 seconds
            knockback: 1,
            description: "A divine rose petal blessed with power",
            color: "#B22222",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        legendary: {
            name: "Eternal Rose Petal",
            damage: 405,
            health: 405,
            size: 1.3,
            speed: 1.0,
            cooldown: 1500, // 4 seconds
            knockback: 1,
            description: "An eternal rose petal that never wilts",
            color: "#FF1493",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        mythic: {
            name: "Celestial Rose Petal",
            damage: 1215,
            health: 1215,
            size: 1.4,
            speed: 1.0,
            cooldown: 1500, // 3 seconds
            knockback: 1,
            description: "A celestial rose petal from the heavens",
            color: "#FF6347",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        ultra: {
            name: "Ultra Rose Petal",
            damage: 3645,
            health: 3645,
            size: 1.5,
            speed: 1.0,
            cooldown: 1500, // 2.5 seconds
            knockback: 1,
            description: "An ultra rose petal with cosmic beauty",
            color: "#de1f65",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        super: {
            name: "Super Rose Petal",
            damage: 10935,
            health: 10935,
            size: 1.6,
            speed: 1.0,
            cooldown: 1500, // 2 seconds
            knockback: 1,
            description: "A super rose petal with divine elegance",
            color: "#2bffa4",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        unique: {
            name: "Unique Rose Petal",
            damage: 32805,
            health: 32805,
            size: 1.7,
            speed: 1.0,
            cooldown: 1500, // 1.5 seconds
            knockback: 1,
            description: "A unique rose petal of ultimate perfection",
            color: "#bf00ff",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        }
    },
    stinger: {
        common: {
            name: "Stinger",
            damage: 100,
            health: 2,
            size: 0.8,
            speed: 1.0,
            cooldown: 5000, // 6 seconds
            knockback: 1,
            description: "A fast, sharp petal that prioritizes offense",
            color: "#FFD700",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        uncommon: {
            name: "Venomous Stinger",
            damage: 300,
            health: 6,
            size: 0.85,
            speed: 1.0,
            cooldown: 5000, // 5 seconds
            knockback: 1,
            description: "A poisonous stinger with deadly precision",
            color: "#FFA500",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        rare: {
            name: "Barbed Stinger",
            damage: 900,
            health: 18,
            size: 0.9,
            speed: 1.0,
            cooldown: 5000, // 4 seconds
            knockback: 1,
            description: "A barbed stinger that tears through enemies",
            color: "#FF8C00",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        epic: {
            name: "Razor Stinger",
            damage: 2700,
            health: 54,
            size: 0.95,
            speed: 1.0,
            cooldown: 5000, // 3 seconds
            knockback: 1,
            description: "A razor-sharp stinger of incredible lethality",
            color: "#FF7F50",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        legendary: {
            name: "Infernal Stinger",
            damage: 8100,
            health: 162,
            size: 1.0,
            speed: 1.0,
            cooldown: 5000, // 2.5 seconds
            knockback: 1,
            description: "An infernal stinger wreathed in flames",
            color: "#FF4500",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        mythic: {
            name: "Void Stinger",
            damage: 24300,
            health: 486,
            size: 1.1,
            speed: 1.0,
            cooldown: 5000, // 2 seconds
            knockback: 1,
            description: "A void stinger that pierces reality itself",
            color: "#800080",
            image: `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">

  <!-- Top triangle (Blue) -->
  <polygon
    points="100,20 150,110 50,110"
    style="fill:black;" />

  <!-- Bottom-left triangle (Red) -->
  <polygon
    points="50,110 100,200 0,200"
    style="fill:black;" />

  <!-- Bottom-right triangle (Green) -->
  <polygon
    points="150,110 200,200 100,200"
    style="fill:black;" />

</svg>

`
        },
        ultra: {
            name: "Ultra Stinger",
            damage: 72900,
            health: 1458,
            size: 1.2,
            speed: 1.0,
            cooldown: 5000, // 1.5 seconds
            knockback: 1,
            description: "An ultra stinger with cosmic precision",
            color: "#de1f65",
            image: `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">

  <!-- Top triangle (Blue) -->
  <polygon
    points="100,20 150,110 50,110"
    style="fill:black;" />

  <!-- Bottom-left triangle (Red) -->
  <polygon
    points="50,110 100,200 0,200"
    style="fill:black;" />

  <!-- Bottom-right triangle (Green) -->
  <polygon
    points="150,110 200,200 100,200"
    style="fill:black;" />

</svg>

`
        },
        super: {
            name: "Super Stinger",
            damage: 218700,
            health: 4374,
            size: 1.3,
            speed: 1.0,
            cooldown: 5000, // 1 second
            knockback: 1,
            description: "A super stinger with divine lethality",
            color: "#2bffa4",
            image: `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">

  <!-- Top triangle (Blue) -->
  <polygon
    points="100,20 150,110 50,110"
    style="fill:black;" />

  <!-- Bottom-left triangle (Red) -->
  <polygon
    points="50,110 100,200 0,200"
    style="fill:black;" />

  <!-- Bottom-right triangle (Green) -->
  <polygon
    points="150,110 200,200 100,200"
    style="fill:black;" />

</svg>

`
        },
        unique: {
            name: "Unique Stinger",
            damage: 656100,
            health: 13122,
            size: 1.4,
            speed: 1.0,
            cooldown: 5000, // 0.5 seconds
            knockback: 1,
            description: "A unique stinger of ultimate destruction",
            color: "#bf00ff",
            image: `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">

  <!-- Top triangle (Blue) -->
  <polygon
    points="100,20 150,110 50,110"
    style="fill:black;" />

  <!-- Bottom-left triangle (Red) -->
  <polygon
    points="50,110 100,200 0,200"
    style="fill:black;" />

  <!-- Bottom-right triangle (Green) -->
  <polygon
    points="150,110 200,200 100,200"
    style="fill:black;" />

</svg>

`
        }
    }
};
function getPetalStats(petalType, rarity) {
    return PETAL_CONFIG[petalType]?.[rarity] || null;
}
function getAllPetalTypes() {
    return Object.keys(PETAL_CONFIG);
}
function getPetalRarities(petalType) {
    return Object.keys(PETAL_CONFIG[petalType] || {});
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};

// NAMESPACE OBJECT: ./node_modules/socket.io-parser/build/esm/index.js
var socket_io_parser_build_esm_namespaceObject = {};
__webpack_require__.r(socket_io_parser_build_esm_namespaceObject);
__webpack_require__.d(socket_io_parser_build_esm_namespaceObject, {
  Decoder: () => (Decoder),
  Encoder: () => (Encoder),
  PacketType: () => (PacketType),
  protocol: () => (build_esm_protocol)
});

;// ./src/imageAssets.ts
// Auto-generated file - do not edit
const IMAGE_ASSETS = {
    "background": "data:image/png;base64,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",
    "coral": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAfUAAAH0CAMAAAATykSGAAAACXBIWXMAAA7DAAAOwwHHb6hkAAAB5lBMVEUpzCgvziMAvk840RoGxEgEwkoDwUwP0TkPzjsHxUY6/gE7/wEBwE0t9A4t+Qg8/wAt9A8e4yMe3ygP1TQ5/gIA/wc8/wEP/wUe/QYe+Awe5x8e4SUt8xAt+gge/wQe/Agt+wct9Q0P/Qgt/AUe4iQe4Cce+wkPzzst/QUe5iAt8hEt/QQP/Agt8hAe9wwt+wYP0Tge4iUe/Act+Qkt8w8e5h8e+wge4SYt/AYt+gce+Ase/gUe5SEe+goe3ycP/AkP+wst9Q4P0jgt8REP/gYe4yQt8RIP0zYe+gke+QoP+wke5CIe+QsU1DUe4CYv8w8e/QcP/gcu+wc3/wEf4Cct9gwf4yMw/wIt/wIP0DoP+woy/wEP0jcj/wMu+wY5/wAz/QMu/AU3/gIQ0Doa2ywT0jcGxUge5SAMy0AGxEcCwE0R0Tg4/gI4/AQv/AUH/wY1+wYJ/wYc3Son6Rsx9Qwx9ws0/QMw/AUx+ggR0TkEw0oP1DUY2C8U1DQZ2i0c3Cop/gQo/gQg/gUU/wUAwE0Av04e/gQe6B4e9g4P0Dkt9g0Pzzot+Ake5CEk5SAz+Ak0+wUP/ggv/QQm/gQy/wIm/wMg/gQR/wUh/wM0/wEf/wQR0zcP0zct/gMe/wUqzCgqzCctziSAnWRMAAAAonRSTlP/1f/H/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9XFlwYRAAAOs0lEQVR4nO3d+XtcVR3H8TqoXMTJTUbCbZu9SWmaEoPJEBK6QJu2FIOxiEhBXFFRUMF9F3eLgvsuuPynMlnmfO8yLS3nnnPN5/3+qb3J05nneXXunHPuzLkHDpBcbztwoEVq3YK6YKgrhrpiqCuGumKoK4a6YqgrhrpiqCuGumKoK4a6YqgrhrpiqCuGumKoK4a6YqgrhrpiqCuGumKoK4a6YqgrhrpiqCuG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",
    "exit": "data:image/png;base64,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",
    "fish": "data:image/png;base64,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",
    "health_potion": "data:image/png;base64,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",
    "octopus": "data:image/png;base64,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",
    "palm": "data:image/png;base64,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",
    "player": "data:image/png;base64,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",
    "shield": "data:image/png;base64,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",
    "speed_boost": "data:image/png;base64,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",
    "wall": "data:image/png;base64,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"
};

;// ./src/SVGLoader.ts
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

;// ./src/constants.ts
// Add these constants at the top with the others
const FISH_DETECTION_RADIUS = 500; // How far fish can detect players
const PLAYER_BASE_SPEED = 5; // Base player speed to match
const FISH_RETURN_SPEED = 0.5; // Speed at which fish return to their normal behavior
// Viewport optimization constants
const VIEWPORT_BUFFER = 500; // Extra distance beyond viewport to keep enemies active
const ENEMY_DESPAWN_TIME = 30000; // 30 seconds in milliseconds
// Viewport dimensions
const VIEWPORT_WIDTH = 1920;
const VIEWPORT_HEIGHT = 1080;
const VIEWPORT_AREA = VIEWPORT_WIDTH * VIEWPORT_HEIGHT; // 2,073,600 pixels²
const players = {};
const dots = (/* unused pure expression or super */ null && ([]));
const enemies = (/* unused pure expression or super */ null && ([]));
const obstacles = (/* unused pure expression or super */ null && ([]));
const items = (/* unused pure expression or super */ null && ([]));
const WORLD_WIDTH = 20000;
const WORLD_HEIGHT = 20000;
const ACTUAL_WORLD_WIDTH = 20000;
const ACTUAL_WORLD_HEIGHT = 20000;
// Density calculation constants (defined after world dimensions)
const TOTAL_WORLD_AREA = ACTUAL_WORLD_WIDTH * ACTUAL_WORLD_HEIGHT; // 400,000,000 pixels²
const ORIGINAL_ENEMY_COUNT = 1000;
const ORIGINAL_ENEMY_DENSITY = ORIGINAL_ENEMY_COUNT / TOTAL_WORLD_AREA; // 0.0000025 enemies per pixel²
const VIEWPORT_WITH_BUFFER_AREA = (VIEWPORT_WIDTH + VIEWPORT_BUFFER * 2) * (VIEWPORT_HEIGHT + VIEWPORT_BUFFER * 2); // 6,073,600 pixels²
const ENEMIES_PER_VIEWPORT = Math.ceil(ORIGINAL_ENEMY_DENSITY * VIEWPORT_WITH_BUFFER_AREA); // ~15 enemies per viewport
const OLD_WORLD_WIDTH = 10000;
const OLD_WORLD_HEIGHT = 2000;
const PVP_WORLD_WIDTH = 10000;
const PVP_WORLD_HEIGHT = 10000;
const SCALE_FACTOR = 1;
//export let ENEMY_COUNT = 200;
const OBSTACLE_COUNT = 20;
const ENEMY_CORAL_PROBABILITY = 0.3;
const ENEMY_CORAL_HEALTH = 50;
const ENEMY_CORAL_DAMAGE = 5;
const PLAYER_MAX_HEALTH = 100;
const ENEMY_MAX_HEALTH = 50;
const PLAYER_DAMAGE = 5;
const ENEMY_DAMAGE = 20;
const DECORATION_COUNT = 100;
const SAND_COUNT = 50; // Reduced from 200 to 50
const MIN_SAND_RADIUS = 50; // Increased from 30 to 50
const MAX_SAND_RADIUS = 120; // Increased from 80 to 120
const ENEMY_TIERS = {
    common: { health: 5, speed: 0.5, damage: 5, probability: 0.4, color: '#7eef6d' },
    uncommon: { health: 40, speed: 0.75, damage: 10, probability: 0.3, color: '#ffe65d' },
    rare: { health: 60, speed: 1, damage: 15, probability: 0.15, color: '#4d52e3' },
    epic: { health: 80, speed: 1.25, damage: 20, probability: 0.1, color: '#861fde' },
    legendary: { health: 100, speed: 1.5, damage: 25, probability: 0.04, color: '#1fdbde' },
    mythic: { health: 150, speed: 2, damage: 30, probability: 0.01, color: '#de1f65' },
    ultra: { health: 450, speed: 2, damage: 90, probability: 0.0001, color: '#de1f65' }
};
const MAX_INVENTORY_SIZE = 5;
const RESPAWN_INVULNERABILITY_TIME = 3000; // 3 seconds of invulnerability after respawn
const MAX_SPEED = 90;
// Add knockback constants at the top with other constants
const KNOCKBACK_FORCE = 5; // Reduced for faster movement with many enemies
const KNOCKBACK_RECOVERY_SPEED = 0.7; // Faster decay to reduce movement resistance
// Add XP-related constants
const BASE_XP_REQUIREMENT = 100;
const XP_MULTIPLIER = 1.25;
const HEALTH_PER_LEVEL = 10;
const DAMAGE_PER_LEVEL = 2;
const PLAYER_SIZE = 40;
const ENEMY_SIZE = 40;
// Define zone boundaries for different tiers
const ZONE_BOUNDARIES = {
    common: { start: 0, end: 4000 },
    uncommon: { start: 4000, end: 8000 },
    rare: { start: 8000, end: 12000 },
    epic: { start: 12000, end: 16000 },
    legendary: { start: 16000, end: 18000 },
    mythic: { start: 18000, end: WORLD_WIDTH }
};
// Add enemy size multipliers like in singleplayer
const ENEMY_SIZE_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.2,
    rare: 1.4,
    epic: 1.6,
    legendary: 1.8,
    mythic: 2.0,
    ultra: 2.5,
    super: 3.0,
    unique: 3.5
};
// Add drop chances like in singleplayer
const DROP_CHANCES = {
    common: 0.1, // 10% chance
    uncommon: 0.2, // 20% chance
    rare: 0.3, // 30% chance
    epic: 0.4, // 40% chance
    legendary: 0.5, // 50% chance
    mythic: 0.75, // 75% chance
    ultra: 0.9, // 90% chance
    super: 0.95, // 95% chance
    unique: 1.0 // 100% chance
};
// Add maze configuration
const MAZE_CELL_SIZE = 1000; // Size of each maze cell
const MAZE_WALL_THICKNESS = 100; // Thickness of maze walls
// Define the permanent map layout
const WORLD_MAP = [
    {
        "type": "wall",
        "x": 28.28125,
        "y": 80,
        "width": 20,
        "height": 19890,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 48.28125,
        "y": 100,
        "width": 19840,
        "height": 40,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 19818.28125,
        "y": 130,
        "width": 40,
        "height": 19830,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 38.28125,
        "y": 19880,
        "width": 19790,
        "height": 50,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 178.28125,
        "y": 9290,
        "width": 1550,
        "height": 1730,
        "properties": {
            "spawnType": "common"
        }
    },
    {
        "type": "spawn",
        "x": 248.28125,
        "y": 7820,
        "width": 2780,
        "height": 1430,
        "properties": {
            "spawnType": "common"
        }
    },
    {
        "type": "wall",
        "x": 2308.28125,
        "y": 9670,
        "width": 200,
        "height": 2860,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 428.28125,
        "y": 6650,
        "width": 3590,
        "height": 270,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 468.28125,
        "y": 11270,
        "width": 1510,
        "height": 1490,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "spawn",
        "x": 1228.28125,
        "y": 13030,
        "width": 4250,
        "height": 1150,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "wall",
        "x": 4368.28125,
        "y": 13890,
        "width": 310,
        "height": 2890,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4558.28125,
        "y": 13870,
        "width": 5680,
        "height": 260,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 5858.28125,
        "y": 8830,
        "width": 250,
        "height": 3980,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1078.28125,
        "y": 1760,
        "width": 270,
        "height": 390,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2848.28125,
        "y": 3610,
        "width": 350,
        "height": 450,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4448.28125,
        "y": 820,
        "width": 340,
        "height": 270,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 528.28125,
        "y": 5380,
        "width": 170,
        "height": 210,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 18.28125,
        "y": 6670,
        "width": 510,
        "height": 190,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3978.28125,
        "y": 6390,
        "width": 2540,
        "height": 320,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6138.28125,
        "y": 4290,
        "width": 260,
        "height": 2150,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6748.28125,
        "y": 7470,
        "width": 2560,
        "height": 170,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7588.28125,
        "y": 8670,
        "width": 200,
        "height": 1080,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7728.28125,
        "y": 9610,
        "width": 3070,
        "height": 140,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8368.28125,
        "y": 9760,
        "width": 150,
        "height": 1580,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8488.28125,
        "y": 11270,
        "width": 1540,
        "height": 140,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9048.28125,
        "y": 9730,
        "width": 180,
        "height": 1050,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 318.28125,
        "y": 490,
        "width": 2960,
        "height": 5540,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "spawn",
        "x": 3428.28125,
        "y": 530,
        "width": 2670,
        "height": 5460,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "wall",
        "x": 6178.28125,
        "y": 2820,
        "width": 1380,
        "height": 120,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6958.28125,
        "y": 2920,
        "width": 170,
        "height": 1370,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8878.28125,
        "y": 4620,
        "width": 3370,
        "height": 190,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8918.28125,
        "y": 120,
        "width": 140,
        "height": 4510,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7308.28125,
        "y": 1380,
        "width": 1670,
        "height": 170,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6358.28125,
        "y": 5550,
        "width": 3390,
        "height": 160,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9258.28125,
        "y": 6470,
        "width": 150,
        "height": 1030,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 3078.28125,
        "y": 7680,
        "width": 2710,
        "height": 1460,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 5948.28125,
        "y": 6950,
        "width": 750,
        "height": 1780,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 7168.28125,
        "y": 6090,
        "width": 1970,
        "height": 1230,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 7228.28125,
        "y": 3080,
        "width": 1610,
        "height": 2370,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 6248.28125,
        "y": 3100,
        "width": 610,
        "height": 1040,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 6498.28125,
        "y": 4350,
        "width": 560,
        "height": 1010,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 2628.28125,
        "y": 9420,
        "width": 3090,
        "height": 3400,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 398.28125,
        "y": 14250,
        "width": 3950,
        "height": 1510,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "wall",
        "x": 2208.28125,
        "y": 13980,
        "width": 220,
        "height": 4680,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1078.28125,
        "y": 18340,
        "width": 1160,
        "height": 240,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2358.28125,
        "y": 18550,
        "width": 8030,
        "height": 270,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4648.28125,
        "y": 15320,
        "width": 2140,
        "height": 220,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6078.28125,
        "y": 14080,
        "width": 210,
        "height": 830,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4628.28125,
        "y": 16670,
        "width": 3110,
        "height": 140,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7128.28125,
        "y": 15830,
        "width": 160,
        "height": 880,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8818.28125,
        "y": 14130,
        "width": 200,
        "height": 3440,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10178.28125,
        "y": 14060,
        "width": 160,
        "height": 3350,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 2638.28125,
        "y": 16950,
        "width": 5990,
        "height": 1450,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 6398.28125,
        "y": 9070,
        "width": 1080,
        "height": 4560,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 8578.28125,
        "y": 8010,
        "width": 6480,
        "height": 1540,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 9088.28125,
        "y": 14210,
        "width": 1010,
        "height": 4030,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "wall",
        "x": 11908.28125,
        "y": 9630,
        "width": 250,
        "height": 5120,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10978.28125,
        "y": 14410,
        "width": 980,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10618.28125,
        "y": 7630,
        "width": 2610,
        "height": 230,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15008.28125,
        "y": 15060,
        "width": 260,
        "height": 3420,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14368.28125,
        "y": 10860,
        "width": 330,
        "height": 360,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16248.28125,
        "y": 11320,
        "width": 320,
        "height": 400,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13328.28125,
        "y": 13280,
        "width": 290,
        "height": 290,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 17128.28125,
        "y": 13410,
        "width": 300,
        "height": 310,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14798.28125,
        "y": 12820,
        "width": 260,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 17118.28125,
        "y": 9130,
        "width": 370,
        "height": 310,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15498.28125,
        "y": 9660,
        "width": 320,
        "height": 220,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13598.28125,
        "y": 8540,
        "width": 200,
        "height": 240,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12658.28125,
        "y": 10610,
        "width": 320,
        "height": 260,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 12558.28125,
        "y": 10190,
        "width": 5100,
        "height": 4540,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 15518.28125,
        "y": 15120,
        "width": 3800,
        "height": 3930,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 5088.28125,
        "y": 19000,
        "width": 1300,
        "height": 810,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 8348.28125,
        "y": 19080,
        "width": 1230,
        "height": 700,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 6538.28125,
        "y": 19050,
        "width": 1550,
        "height": 730,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 388.28125,
        "y": 18910,
        "width": 4400,
        "height": 840,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "wall",
        "x": 11448.28125,
        "y": 1810,
        "width": 200,
        "height": 2810,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12188.28125,
        "y": 4780,
        "width": 3860,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11998.28125,
        "y": 5620,
        "width": 220,
        "height": 2030,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14218.28125,
        "y": 5010,
        "width": 300,
        "height": 2280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14228.28125,
        "y": 4930,
        "width": 280,
        "height": 150,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12998.28125,
        "y": 6020,
        "width": 1260,
        "height": 210,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14468.28125,
        "y": 6660,
        "width": 1420,
        "height": 290,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12858.28125,
        "y": 1030,
        "width": 4230,
        "height": 190,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16948.28125,
        "y": 1190,
        "width": 190,
        "height": 4520,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13008.28125,
        "y": 1690,
        "width": 3450,
        "height": 210,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16348.28125,
        "y": 2010,
        "width": 210,
        "height": 3700,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13078.28125,
        "y": 2460,
        "width": 2880,
        "height": 160,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15758.28125,
        "y": 2800,
        "width": 210,
        "height": 1720,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 12928.28125,
        "y": 1280,
        "width": 3880,
        "height": 330,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 16668.28125,
        "y": 1620,
        "width": 260,
        "height": 4260,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 12948.28125,
        "y": 2050,
        "width": 3280,
        "height": 320,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 16048.28125,
        "y": 2370,
        "width": 260,
        "height": 3260,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "spawn",
        "x": 14978.28125,
        "y": 2650,
        "width": 700,
        "height": 2000,
        "properties": {
            "spawnType": "common"
        }
    },
    {
        "type": "spawn",
        "x": 13078.28125,
        "y": 2690,
        "width": 1800,
        "height": 1900,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "wall",
        "x": 10028.28125,
        "y": 110,
        "width": 390,
        "height": 3940,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 9108.28125,
        "y": 230,
        "width": 840,
        "height": 4260,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "spawn",
        "x": 10088.28125,
        "y": 4210,
        "width": 1260,
        "height": 250,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "spawn",
        "x": 10578.28125,
        "y": 380,
        "width": 450,
        "height": 3840,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 10978.28125,
        "y": 610,
        "width": 1770,
        "height": 950,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 12038.28125,
        "y": 1410,
        "width": 800,
        "height": 3000,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "teleporter",
        "x": 528.28125,
        "y": 16240,
        "width": 550,
        "height": 510,
        "properties": {
            "teleportTo": {
                "x": 0,
                "y": 0,
                "serverPort": 3001
            }
        }
    },
    {
        "type": "teleporter",
        "x": 9928.28125,
        "y": 6200,
        "width": 980,
        "height": 560,
        "properties": {
            "teleportTo": {
                "x": 0,
                "y": 0,
                "serverPort": 3000
            }
        }
    },
    {
        "type": "teleporter",
        "x": 8828.28125,
        "y": 12000,
        "width": 860,
        "height": 650,
        "properties": {
            "teleportTo": {
                "x": 0,
                "y": 0,
                "serverPort": 3002
            }
        }
    }
];
// Add map validation function
function validateWorldMap(map) {
    // Check for required border walls
    const hasTopWall = map.some(el => el.type === 'wall' && el.y === 0 && el.width === WORLD_WIDTH);
    const hasBottomWall = map.some(el => el.type === 'wall' && el.y === WORLD_HEIGHT - 100);
    const hasLeftWall = map.some(el => el.type === 'wall' && el.x === 0);
    const hasRightWall = map.some(el => el.type === 'wall' && el.x === WORLD_WIDTH - 100);
    if (!hasTopWall || !hasBottomWall || !hasLeftWall || !hasRightWall) {
        console.error('Map is missing border walls');
        return false;
    }
    // Check for at least one spawn point per tier
    const spawnTypes = map
        .filter(el => el.type === 'spawn')
        .map(el => el.properties?.spawnType)
        .filter((type) => type !== undefined);
    const requiredSpawnTypes = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    const hasAllSpawnTypes = requiredSpawnTypes.every(type => spawnTypes.includes(type));
    if (!hasAllSpawnTypes) {
        console.error('Map is missing spawn points for some tiers');
        return false;
    }
    // Check for overlapping elements
    for (let i = 0; i < map.length; i++) {
        for (let j = i + 1; j < map.length; j++) {
            if (elementsOverlap(map[i], map[j])) {
                console.error('Map has overlapping elements:', map[i], map[j]);
                return false;
            }
        }
    }
    return true;
}
function elementsOverlap(a, b) {
    return !(a.x + a.width < b.x ||
        b.x + b.width < a.x ||
        a.y + a.height < b.y ||
        b.y + b.height < a.y);
}
// Add map element type guards
function isWall(element) {
    return element.type === 'wall';
}
function isSpawn(element) {
    return element.type === 'spawn';
}
function isTeleporter(element) {
    return element.type === 'teleporter';
}
function isSafeZone(element) {
    return element.type === 'safe_zone';
}
// Default server configuration - can be overridden via environment variables or config file
const DEFAULT_SERVER_CONFIGS = [
    { port: 3000, host: 'localhost', name: 'Server1' },
    { port: 3001, host: 'localhost', name: 'Server2' },
    { port: 3002, host: 'localhost', name: 'Server3' }
];
// Get server configuration from environment or use defaults
function getServerConfigs() {
    const configStr = process.env.SERVER_CONFIGS;
    if (configStr) {
        try {
            return JSON.parse(configStr);
        }
        catch (error) {
            console.error('Failed to parse SERVER_CONFIGS environment variable:', error);
        }
    }
    return DEFAULT_SERVER_CONFIGS;
}
// Find server config by port
function getServerConfigByPort(port) {
    return getServerConfigs().find(config => config.port === port);
}
// Example cross-server teleporter configurations
// Add these to your WORLD_MAP array to test cross-server teleportation
const EXAMPLE_CROSS_SERVER_TELEPORTERS = [
    // Teleporter from Server 3000 to Server 3001
    {
        type: 'teleporter',
        x: 2000,
        y: 1000,
        width: 300,
        height: 300,
        properties: {
            teleportTo: {
                x: 800,
                y: 800,
                serverPort: 3001
            }
        }
    },
    // Teleporter from Server 3001 to Server 3002
    {
        type: 'teleporter',
        x: 1200,
        y: 1200,
        width: 300,
        height: 300,
        properties: {
            teleportTo: {
                x: 1500,
                y: 1500,
                serverPort: 3002
            }
        }
    },
    // Return teleporter from Server 3002 to Server 3000
    {
        type: 'teleporter',
        x: 1500,
        y: 2000,
        width: 300,
        height: 300,
        properties: {
            teleportTo: {
                x: 2000,
                y: 1000,
                serverPort: 3000
            }
        }
    }
];

// EXTERNAL MODULE: ./src/petals.ts
var src_petals = __webpack_require__(375);
;// ./src/mobs.ts
// Scaling multipliers for mob stats
const HEALTH_SCALING = {
    common: 1,
    uncommon: 3.75,
    rare: 13.5,
    epic: 54,
    legendary: 405,
    mythic: 2430,
    ultra: 29160,
    super: 1312200,
    unique: 19683000
};
const DAMAGE_SCALING = {
    common: 1,
    uncommon: 3,
    rare: 9,
    epic: 27,
    legendary: 81,
    mythic: 243,
    ultra: 729,
    super: 2187,
    unique: 6561
};
// XP scaling: Base value of 10, multiplied by 3 for each rarity level
const XP_SCALING = {
    common: 10,
    uncommon: 30,
    rare: 90,
    epic: 270,
    legendary: 810,
    mythic: 2430,
    ultra: 7290,
    super: 21870,
    unique: 65610
};
// Base stats for each mob type (common values)
const BASE_STATS = {
    bee: { damage: 50, health: 37.5 },
    ladybug: { damage: 10, health: 62.5 },
    soldier_ant: { damage: 10, health: 100 }
};
const MOB_CONFIG = {
    bee: {
        common: {
            name: "Common Bee",
            damage: 50,
            health: 37.5,
            size: 1.0,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless bee that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
            is_hostile: false,
            range: 100,
            xp: 1
        },
        uncommon: {
            name: "Uncommon Bee",
            damage: 150,
            health: 140.625,
            size: 3.0,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless bee that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
            is_hostile: false,
            range: 100,
            xp: 3
        },
        rare: {
            name: "Rare Bee",
            damage: 450,
            health: 506.25,
            size: 9,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless bee that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
            is_hostile: false,
            range: 100,
            xp: 30
        },
        epic: {
            name: "Epic Bee",
            damage: 1350,
            health: 2025,
            size: 27,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless bee that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
            is_hostile: false,
            range: 100,
            xp: 270
        },
        legendary: {
            name: "Legendary Bee",
            damage: 4050,
            health: 15187.5,
            size: 81,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless bee that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
            is_hostile: false,
            range: 100,
            xp: 1400
        },
        mythic: {
            name: "Mythic Bee",
            damage: 12150,
            health: 91125,
            size: 243,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless bee that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
            is_hostile: false,
            range: 100,
            xp: 32000
        },
        ultra: {
            name: "Ultra Bee",
            damage: 36450,
            health: 1093500,
            size: 729,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "An ultra bee with cosmic power",
            color: "#de1f65",
            image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
            is_hostile: false,
            range: 100,
            xp: 150000
        },
        super: {
            name: "Super Bee",
            damage: 109350,
            health: 49207500,
            size: 2187,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A super bee with divine energy",
            color: "#2bffa4",
            image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
            is_hostile: false,
            range: 100,
            xp: 1200000
        },
        unique: {
            name: "Unique Bee",
            damage: 328050,
            health: 737611250,
            size: 6561,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A unique bee of ultimate power",
            color: "#bf00ff",
            image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
            is_hostile: false,
            range: 100,
            xp: 6800000
        }
    },
    ladybug: {
        common: {
            name: "Common Ladybug",
            damage: 10,
            health: 62.5,
            size: 1.0,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
            is_hostile: false,
            range: 100,
            xp: 1
        },
        uncommon: {
            name: "Uncommon Ladybug",
            damage: 30,
            health: 234.375,
            size: 3.0,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
            is_hostile: false,
            range: 100,
            xp: 3
        },
        rare: {
            name: "Rare Ladybug",
            damage: 90,
            health: 843.75,
            size: 9,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
            is_hostile: false,
            range: 100,
            xp: 30
        },
        epic: {
            name: "Epic Ladybug",
            damage: 270,
            health: 3375,
            size: 27,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
            is_hostile: false,
            range: 100,
            xp: 270
        },
        legendary: {
            name: "Legendary Ladybug",
            damage: 810,
            health: 25312.5,
            size: 81,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
            is_hostile: false,
            range: 100,
            xp: 1400
        },
        mythic: {
            name: "Mythic Ladybug",
            damage: 2430,
            health: 151875,
            size: 243,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
            is_hostile: false,
            range: 100,
            xp: 32000
        },
        ultra: {
            name: "Ultra Ladybug",
            damage: 7290,
            health: 1822500,
            size: 729,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "An ultra ladybug with cosmic power",
            color: "#de1f65",
            image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
            is_hostile: false,
            range: 100,
            xp: 150000
        },
        super: {
            name: "Super Ladybug",
            damage: 21870,
            health: 82012500,
            size: 2187,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A super ladybug with divine energy",
            color: "#2bffa4",
            image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
            is_hostile: false,
            range: 100,
            xp: 1200000
        },
        unique: {
            name: "Unique Ladybug",
            damage: 65610,
            health: 1230187500,
            size: 6561,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A unique ladybug of ultimate power",
            color: "#bf00ff",
            image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
            is_hostile: false,
            range: 100,
            xp: 6800000
        }
    },
    soldier_ant: {
        common: {
            name: "Common Soldier Ant",
            damage: 10,
            health: 100,
            size: 1.0,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A small, hostile soldier ant that flies aggressively",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
            is_hostile: true,
            range: 100,
            xp: 1
        },
        uncommon: {
            name: "Uncommon Soldier Ant",
            damage: 30,
            health: 375,
            size: 3.0,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A small, hostile soldier ant that flies aggressively",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
            is_hostile: true,
            range: 200,
            xp: 3
        },
        rare: {
            name: "Rare Soldier Ant",
            damage: 90,
            health: 1350,
            size: 9,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A small, hostile soldier ant that flies aggressively",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
            is_hostile: true,
            range: 350,
            xp: 30
        },
        epic: {
            name: "Epic Soldier Ant",
            damage: 270,
            health: 5400,
            size: 27,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A small, hostile soldier ant that flies aggressively",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
            is_hostile: true,
            range: 500,
            xp: 270
        },
        legendary: {
            name: "Legendary Soldier Ant",
            damage: 810,
            health: 40500,
            size: 81,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A small, hostile soldier ant that flies aggressively",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
            is_hostile: true,
            range: 600,
            xp: 1400
        },
        mythic: {
            name: "Mythic Soldier Ant",
            damage: 2430,
            health: 243000,
            size: 243,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A small, hostile soldier ant that flies aggressively",
            color: "#87CEEB",
            image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
            is_hostile: true,
            range: 750,
            xp: 32000
        },
        ultra: {
            name: "Ultra Soldier Ant",
            damage: 7290,
            health: 2916000,
            size: 729,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "An ultra soldier ant with cosmic power",
            color: "#de1f65",
            image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
            is_hostile: true,
            range: 750,
            xp: 150000
        },
        super: {
            name: "Super Soldier Ant",
            damage: 21870,
            health: 131220000,
            size: 2187,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A super soldier ant with divine energy",
            color: "#2bffa4",
            image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
            is_hostile: true,
            range: 750,
            xp: 1200000
        },
        unique: {
            name: "Unique Soldier Ant",
            damage: 65610,
            health: 1968300000,
            size: 6561,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A unique soldier ant of ultimate power",
            color: "#bf00ff",
            image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
            is_hostile: true,
            range: 750,
            xp: 6800000
        }
    }
};
function getMobStats(mobType, rarity) {
    return MOB_CONFIG[mobType]?.[rarity] || null;
}
function getAllMobTypes() {
    return Object.keys(MOB_CONFIG);
}
function getMobRarities(mobType) {
    return Object.keys(MOB_CONFIG[mobType] || {});
}

;// ./src/graphics.ts



class Graphics {
    constructor(canvas, playerSprite, wallTexture, octopusSprite, fishSprite, healthPotionSprite, speedBoostSprite, shieldSprite, backgroundTexture) {
        this.cameraX = 0;
        this.cameraY = 0;
        this.zoomLevel = 1.0;
        this.floatingTexts = [];
        this.mapData = [];
        this.MINIMAP_WIDTH = 200;
        this.MINIMAP_HEIGHT = 200;
        this.MINIMAP_PADDING = 10;
        this.playerEye = { x: 0, y: 0 };
        this.wallTexture = new Image();
        this.octopusSprite = new Image();
        this.fishSprite = new Image();
        this.healthPotionSprite = new Image();
        this.speedBoostSprite = new Image();
        this.shieldSprite = new Image();
        this.backgroundTexture = new Image();
        this.MAP_COLORS = {
            wall: 'rgba(102, 102, 102, 0.8)',
            spawn: 'rgba(76, 175, 80, 0.3)',
            teleporter: 'rgba(33, 150, 243, 0.5)',
            safe_zone: 'rgba(255, 193, 7, 0.2)'
        };
        this.ENEMY_COLORS = {
            common: '#7eef6d',
            uncommon: '#ffe65d',
            rare: '#4d52e3',
            epic: '#861fde',
            legendary: '#de1f1f',
            mythic: '#1fdbde',
            ultra: '#de1f65',
            super: '#2bffa4',
            unique: '#bf00ff'
        };
        this.ENEMY_SIZE_MULTIPLIERS = {
            common: 1.0,
            uncommon: 1.2,
            rare: 1.4,
            epic: 1.6,
            legendary: 1.8,
            mythic: 2.0,
            ultra: 2.5,
            super: 3.0,
            unique: 3.5
        };
        this.ENEMY_MAX_HEALTH = {
            common: 20,
            uncommon: 40,
            rare: 60,
            epic: 80,
            legendary: 100,
            mythic: 150,
            ultra: 450,
            super: 1350,
            unique: 4050
        };
        this.ITEM_RARITY_COLORS = {
            common: '#7eef6d',
            uncommon: '#ffe65d',
            rare: '#4d52e3',
            epic: '#861fde',
            legendary: '#de1f1f',
            mythic: '#1fdbde',
            ultra: '#de1f65',
            super: '#2bffa4',
            unique: '#bf00ff'
        };
        this.showHitboxes = false;
        this.itemSprites = {};
        this.petalImageCache = {};
        this.mobImageCache = new Map();
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
        this.playerSprite = playerSprite;
        this.wallTexture = wallTexture;
        this.octopusSprite = octopusSprite;
        this.fishSprite = fishSprite;
        this.healthPotionSprite = healthPotionSprite;
        this.speedBoostSprite = speedBoostSprite;
        this.shieldSprite = shieldSprite;
        this.backgroundTexture = backgroundTexture;
        // Preload all mob SVG images
        this.preloadMobImages();
    }
    async preloadMobImages() {
        const mobTypes = getAllMobTypes();
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        for (const mobType of mobTypes) {
            for (const rarity of rarities) {
                const mobStats = getMobStats(mobType, rarity);
                if (mobStats && mobStats.image) {
                    const cacheKey = `${mobType}_${rarity}`;
                    try {
                        await this.loadSVGAsImage(mobStats.image, cacheKey);
                        console.log(`[GRAPHICS] Preloaded ${mobType} ${rarity} sprite`);
                    }
                    catch (error) {
                        console.error(`[GRAPHICS] Failed to load ${mobType} ${rarity} sprite:`, error);
                    }
                }
            }
        }
    }
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    setCamera(x, y, zoom = 1.0) {
        this.cameraX = x;
        this.cameraY = y;
        this.zoomLevel = zoom;
    }
    setMap(mapData) {
        this.mapData = mapData;
    }
    showFloatingText(x, y, text, color, fontSize) {
        this.floatingTexts.push({
            x,
            y,
            text,
            color,
            fontSize,
            alpha: 1.0,
            yOffset: 0,
            lifetime: 1000
        });
    }
    drawMap(world_map_data) {
        // Draw all map elements
        world_map_data.forEach(element => {
            const x = element.x;
            const y = element.y;
            const width = element.width;
            const height = element.height;
            // Only draw elements that are visible in the viewport
            if (x + width >= this.cameraX &&
                x <= this.cameraX + this.canvas.width &&
                y + height >= this.cameraY &&
                y <= this.cameraY + this.canvas.height) {
                if (element.type === 'wall') {
                    // Draw wall texture tiled
                    const pattern = this.ctx.createPattern(this.wallTexture, 'repeat');
                    if (pattern) {
                        this.ctx.save();
                        this.ctx.fillStyle = pattern;
                        this.ctx.fillRect(x, y, width, height);
                        this.ctx.restore();
                    }
                }
                else {
                    // Draw other elements normally
                    this.ctx.fillStyle = this.MAP_COLORS[element.type];
                    this.ctx.fillRect(x, y, width, height);
                    // Add visual indicators for special elements
                    if (element.type === 'teleporter') {
                        this.drawTeleporter(x, y, width, height);
                    }
                    else if (element.type === 'spawn') {
                        this.drawSpawnPoint(x, y, width, height, element.properties?.spawnType);
                    }
                }
                // Draw debug info if hitboxes are enabled
                if (this.showHitboxes) {
                    this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
                    this.ctx.strokeRect(x, y, width, height);
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Arial';
                    this.ctx.fillText(`${Math.round(x)},${Math.round(y)}`, x, y - 5);
                }
            }
        });
    }
    drawTeleporter(x, y, width, height) {
        // Create a pulsing effect
        const time = Date.now() / 1000;
        const pulseSize = 0.2 * Math.sin(time * 2) + 0.8; // Pulse between 0.6 and 1.0
        // Draw outer glow
        const gradient = this.ctx.createRadialGradient(x + width / 2, y + height / 2, 0, x + width / 2, y + height / 2, (width / 2) * pulseSize);
        gradient.addColorStop(0, 'rgba(0, 183, 255, 0.6)');
        gradient.addColorStop(0.6, 'rgba(0, 106, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 47, 255, 0)');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(x, y, width, height);
        // Draw portal rings
        const numRings = 3;
        this.ctx.lineWidth = 4;
        for (let i = 0; i < numRings; i++) {
            const ringSize = ((i + 1) / numRings) * width / 2 * pulseSize;
            const opacity = 1 - (i / numRings);
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.ellipse(x + width / 2, y + height / 2, ringSize, ringSize * 0.4, 0, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        // Add some particle effects
        const numParticles = 8;
        const particleTime = time * 3;
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        for (let i = 0; i < numParticles; i++) {
            const angle = (i / numParticles) * Math.PI * 2 + particleTime;
            const particleX = x + width / 2 + Math.cos(angle) * width / 3 * pulseSize;
            const particleY = y + height / 2 + Math.sin(angle) * height / 4 * pulseSize;
            this.ctx.beginPath();
            this.ctx.arc(particleX, particleY, 3, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }
    getTierColor(tier) {
        const colors = {
            common: 'rgba(128, 128, 128, 0.3)',
            uncommon: 'rgba(0, 128, 0, 0.3)',
            rare: 'rgba(0, 0, 255, 0.3)',
            epic: 'rgba(128, 0, 128, 0.3)',
            legendary: 'rgba(255, 165, 0, 0.3)',
            mythic: 'rgba(255, 0, 0, 0.3)'
        };
        return colors[tier] || colors.common;
    }
    drawSpawnPoint(x, y, width, height, type) {
        // // Draw spawn area indicator
        // const color = type ? this.getTierColor(type) : 'rgba(76, 175, 80, 0.3)';
        // this.ctx.fillStyle = color;
        // this.ctx.fillRect(x, y, width, height);
        // // Add spawn point marker
        // this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        // this.ctx.lineWidth = 2;
        // this.ctx.beginPath();
        // this.ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 4, 0, Math.PI * 2);
        // this.ctx.stroke();
        // // Add tier label
        // if (type) {
        //     this.ctx.fillStyle = 'white';
        //     this.ctx.font = '20px Arial';
        //     this.ctx.textAlign = 'center';
        //     this.ctx.fillText(type.toUpperCase(), x + width / 2, y + height / 2);
        // }
    }
    drawUI(players, socket) {
        // Draw player stats
        const player = players.get(socket);
        if (player) {
            // Draw health bar
            const healthBarWidth = 200;
            const healthBarHeight = 20;
            const healthX = 20;
            const healthY = 20;
            // Health bar background
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(healthX, healthY, healthBarWidth, healthBarHeight);
            // Health bar fill
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
            this.ctx.fillRect(healthX, healthY, (player.health / player.maxHealth) * healthBarWidth, healthBarHeight);
            // Health text
            this.ctx.fillStyle = 'white';
            this.ctx.font = '14px Arial';
            this.ctx.fillText(`Health: ${Math.round(player.health)}/${player.maxHealth}`, healthX + 5, healthY + 15);
            // Draw XP bar
            const xpBarY = healthY + healthBarHeight + 5;
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(healthX, xpBarY, healthBarWidth, healthBarHeight);
            this.ctx.fillStyle = 'rgba(0, 128, 255, 0.7)';
            this.ctx.fillRect(healthX, xpBarY, (player.xp / player.xpToNextLevel) * healthBarWidth, healthBarHeight);
            this.ctx.fillStyle = 'white';
            this.ctx.fillText(`Level ${player.level} - XP: ${player.xp}/${player.xpToNextLevel}`, healthX + 5, xpBarY + 15);
        }
        // Draw minimap
        this.drawMinimap(players, socket);
        // Draw floating texts
        this.drawFloatingTexts();
    }
    s(size) {
        return 1 * size;
    }
    drawFlower(center, eye) {
        this.ctx.lineCap = "round";
        this.ctx.lineWidth = this.s(1.7);
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, this.s(26.5), 0, Math.PI * 2, false);
        this.ctx.fillStyle = "#CFBB50";
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, this.s(23.5), 0, Math.PI * 2, false);
        this.ctx.fillStyle = "#FFE763";
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.moveTo(center.x - this.s(6), center.y + this.s(10));
        this.ctx.quadraticCurveTo(center.x, center.y + this.s(14.5), center.x + this.s(6), center.y + this.s(10));
        this.ctx.strokeStyle = "#000";
        this.ctx.fillStyle = "#000";
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.ellipse(center.x + this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.ellipse(center.x - this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.fill();
        this.ctx.clip();
        this.ctx.beginPath();
        this.ctx.fillStyle = "#fff";
        this.ctx.arc(center.x + this.s(7) + eye.x, center.y + eye.y - this.s(4.8), this.s(3), 0, Math.PI * 2, false);
        this.ctx.arc(center.x - this.s(7) + eye.x, center.y + eye.y - this.s(4.8), this.s(3), 0, Math.PI * 2, false);
        this.ctx.fill();
        this.ctx.lineWidth = this.s(1);
        this.ctx.beginPath();
        this.ctx.ellipse(center.x + this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.ellipse(center.x - this.s(7), center.y - this.s(4.8), this.s(3.2), this.s(6.5), 0, 0, Math.PI * 2, false);
        this.ctx.stroke();
    }
    drawPlayer(player, socket, petalExtension = 1.0) {
        this.ctx.save();
        this.ctx.translate(player.x, player.y);
        // Apply invulnerability visual effect
        if (player.isInvulnerable) {
            const flashRate = 200; // Flash every 200ms
            const currentTime = Date.now();
            const shouldFlash = Math.floor(currentTime / flashRate) % 2 === 0;
            if (shouldFlash) {
                this.ctx.globalAlpha = 0.3; // Make player semi-transparent when flashing
            }
            // Draw invulnerability glow effect
            this.ctx.shadowColor = '#FFFF00';
            this.ctx.shadowBlur = 15;
            this.ctx.shadowOffsetX = 0;
            this.ctx.shadowOffsetY = 0;
        }
        // Draw player sprite
        if (player.id === socket) {
            // Calculate target eye position
            this.playerEye = {
                x: Math.cos(player.angle) * this.s(2),
                y: Math.sin(player.angle) * this.s(4.4)
            };
            // Smooth interpolation of eye position (lerp factor controls smoothness)
            const lerpFactor = 0.15; // Lower = smoother, higher = more responsive
            this.playerEye.x += (this.playerEye.x - this.playerEye.x) * lerpFactor;
            this.playerEye.y += (this.playerEye.y - this.playerEye.y) * lerpFactor;
            // Apply hue rotation for current player
            const offscreen = document.createElement('canvas');
            offscreen.width = this.playerSprite.width;
            offscreen.height = this.playerSprite.height;
            const offCtx = offscreen.getContext('2d');
            offCtx.drawImage(this.playerSprite, 0, 0);
            const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
            offCtx.putImageData(imageData, 0, 0);
            this.drawFlower(this.playerSprite, this.playerEye);
        }
        else {
            // For other players, use their own smooth eye interpolation
            if (!player.eye) {
                player.eye = { x: 0, y: 0 };
                player.targetEye = { x: 0, y: 0 };
            }
            // Calculate target eye position for this player
            player.targetEye = {
                x: Math.sin(player.angle) * this.s(2),
                y: Math.cos(player.angle) * this.s(-4.4)
            };
            // Smooth interpolation
            const lerpFactor = 0.15;
            player.eye.x += (player.targetEye.x - player.eye.x) * lerpFactor;
            player.eye.y += (player.targetEye.y - player.eye.y) * lerpFactor;
            this.drawFlower(this.playerSprite, player.eye);
        }
        // Reset effects after drawing
        if (player.isInvulnerable) {
            this.ctx.globalAlpha = 1.0;
            this.ctx.shadowBlur = 0;
        }
        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = 'red';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.strokeRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
            this.ctx.restore();
        }
        // Draw player name
        this.ctx.fillStyle = 'white';
        this.ctx.textAlign = 'center';
        this.ctx.font = '14px Arial';
        this.ctx.fillText(player.name || 'Anonymous', 0, -30);
        this.ctx.restore();
        // Draw petals around player (outside of transform context)
        this.drawPlayerPetals(player, petalExtension);
    }
    drawPlayerPetals(player, petalExtension = 1.0) {
        // Safety check: ensure player loadout exists before filtering
        if (!player.loadout || !Array.isArray(player.loadout)) {
            return; // Skip drawing petals if loadout is not properly initialized
        }
        // Get all petals from player loadout
        const petals = player.loadout.filter(item => item && item.type === 'petal');
        if (petals.length === 0)
            return;
        const currentTime = Date.now();
        const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
        const angleStep = (Math.PI * 2) / petals.length; // Evenly space petals
        petals.forEach((petal, index) => {
            if (!petal || !petal.petalType || !petal.rarity)
                return;
            const stats = (0,src_petals/* getPetalStats */.q)(petal.petalType, petal.rarity);
            if (!stats)
                return;
            // Skip drawing if petal is on cooldown
            if (petal.onCooldown)
                return;
            // Calculate rotation angle
            const rotationSpeed = stats.speed * 0.002; // Convert to radians per ms
            const baseAngle = index * angleStep;
            const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
            const totalAngle = baseAngle + rotationAngle;
            // Calculate position around player
            const petalX = player.x + Math.cos(totalAngle) * baseRadius;
            const petalY = player.y + Math.sin(totalAngle) * baseRadius;
            // Draw petal using SVG image
            this.ctx.save();
            this.ctx.translate(petalX, petalY);
            this.ctx.rotate(totalAngle + Math.PI / 2); // Orient petal tangent to circle
            const size = 12 * stats.size;
            // Render petal using cached image
            const petalKey = `${petal.petalType}_${petal.rarity}`;
            const petalImage = this.petalImageCache[petalKey];
            if (petalImage) {
                // Use consistent scaling to maintain aspect ratio
                const petalSize = size;
                this.ctx.drawImage(petalImage, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                // Add rarity glow effect
                if (petal.rarity !== 'common') {
                    this.ctx.shadowColor = stats.color;
                    this.ctx.shadowBlur = 5;
                    this.ctx.drawImage(petalImage, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                }
            }
            else {
                // Fallback to colored circle if image not loaded
                this.ctx.fillStyle = stats.color;
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            }
            // Draw health bar for petals
            if (petal.health !== undefined && petal.maxHealth !== undefined && petal.maxHealth > 0) {
                const healthBarWidth = size;
                const healthBarHeight = 3;
                const healthBarY = -size * 0.7 / 2 - 8;
                // Health bar background
                this.ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                this.ctx.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight);
                // Health bar fill
                const healthPercentage = petal.health / petal.maxHealth;
                this.ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
                this.ctx.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth * healthPercentage, healthBarHeight);
            }
            this.ctx.restore();
        });
    }
    async loadSVGAsImage(svgString, cacheKey) {
        // Check cache first
        if (this.mobImageCache.has(cacheKey)) {
            return this.mobImageCache.get(cacheKey);
        }
        return new Promise((resolve, reject) => {
            const img = new Image();
            const dataUrl = 'data:image/svg+xml;base64,' + btoa(svgString);
            img.onload = () => {
                this.mobImageCache.set(cacheKey, img);
                resolve(img);
            };
            img.onerror = reject;
            img.src = dataUrl;
        });
    }
    drawEnemy(enemy) {
        const sizeMultiplier = this.ENEMY_SIZE_MULTIPLIERS[enemy.tier];
        const enemySize = 40 * sizeMultiplier;
        this.ctx.save();
        this.ctx.translate(enemy.x, enemy.y);
        this.ctx.rotate(enemy.angle);
        // Draw enemy sprite using SVG from mob config
        const mobStats = getMobStats(enemy.type, enemy.tier);
        const cacheKey = `${enemy.type}_${enemy.tier}`;
        if (mobStats && mobStats.image && this.mobImageCache.has(cacheKey)) {
            // Use cached SVG image
            const img = this.mobImageCache.get(cacheKey);
            this.ctx.drawImage(img, -enemySize / 2, -enemySize / 2, enemySize, enemySize);
        }
        else if (mobStats && mobStats.image) {
            // Load SVG image asynchronously and cache it
            this.loadSVGAsImage(mobStats.image, cacheKey);
            // For now, use fallback until image loads
            const sprite = enemy.type === 'octopus' ? this.octopusSprite : this.fishSprite;
            this.ctx.drawImage(sprite, -enemySize / 2, -enemySize / 2, enemySize, enemySize);
        }
        else {
            // Fallback to old sprite system if no mob config found
            const sprite = enemy.type === 'octopus' ? this.octopusSprite : this.fishSprite;
            this.ctx.drawImage(sprite, -enemySize / 2, -enemySize / 2, enemySize, enemySize);
        }
        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = this.ENEMY_COLORS[enemy.tier];
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.strokeRect(-enemySize / 2, -enemySize / 2, enemySize, enemySize);
            this.ctx.restore();
        }
        // Draw health bar
        const healthBarWidth = enemySize;
        const healthBarHeight = 5;
        const healthBarY = -enemySize / 2 - 10;
        this.ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        this.ctx.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight);
        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
        this.ctx.fillRect(-healthBarWidth / 2, healthBarY, (enemy.health / enemy.maxHealth) * healthBarWidth, healthBarHeight);
        // Draw enemy tier with tier color
        this.ctx.fillStyle = this.ENEMY_COLORS[enemy.tier];
        this.ctx.textAlign = 'center';
        this.ctx.font = '12px Arial'; // Made text bold for better visibility
        // Add black outline to text for better visibility
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.strokeText(enemy.tier.toUpperCase(), 0, enemySize / 2 + 20);
        // Draw the text
        this.ctx.fillText(enemy.tier.toUpperCase(), 0, enemySize / 2 + 20);
        this.ctx.restore();
    }
    drawItem(item) {
        this.ctx.save();
        this.ctx.translate(item.x, item.y);
        // Draw item rarity glow
        if (item.rarity) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 25, 0, Math.PI * 2);
            this.ctx.fillStyle = `${this.ITEM_RARITY_COLORS[item.rarity]}40`;
            this.ctx.fill();
            this.ctx.restore();
        }
        // Handle different item types
        if (item.type === 'petal') {
            // Draw petal procedurally
            this.drawWorldPetal(item);
        }
        else {
            // Draw other items with sprites
            const sprite = this.itemSprites[item.type];
            if (sprite) {
                this.ctx.drawImage(sprite, -15, -15, 30, 30);
            }
        }
        // Draw hitbox if enabled
        if (this.showHitboxes) {
            this.ctx.save();
            this.ctx.strokeStyle = 'yellow';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
            this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
            this.ctx.strokeRect(-15, -15, 30, 30);
            this.ctx.restore();
        }
        this.ctx.restore();
    }
    drawWorldPetal(item) {
        if (!item.petalType || !item.rarity)
            return;
        const stats = (0,src_petals/* getPetalStats */.q)(item.petalType, item.rarity);
        if (!stats)
            return;
        // Draw petal using cached image
        const size = 12 * stats.size;
        const petalKey = `${item.petalType}_${item.rarity}`;
        const petalImage = this.petalImageCache[petalKey];
        if (petalImage) {
            // Use consistent scaling to maintain aspect ratio
            const petalSize = size;
            this.ctx.drawImage(petalImage, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
            // Add rarity glow effect
            if (item.rarity !== 'common') {
                this.ctx.shadowColor = stats.color;
                this.ctx.shadowBlur = 5;
                this.ctx.drawImage(petalImage, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
            }
        }
        else {
            // Fallback to colored circle if image not loaded
            this.ctx.fillStyle = stats.color;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
        }
    }
    drawFloatingTexts() {
        this.floatingTexts = this.floatingTexts.filter(text => {
            text.y -= 1;
            text.alpha -= 1 / text.lifetime;
            if (text.alpha <= 0)
                return false;
            this.ctx.save();
            this.ctx.globalAlpha = text.alpha;
            this.ctx.fillStyle = text.color;
            this.ctx.font = `${text.fontSize}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.fillText(text.text, text.x, text.y);
            this.ctx.restore();
            return true;
        });
    }
    // Add minimap drawing
    drawMinimap(players, socket) {
        const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
        const minimapY = this.MINIMAP_PADDING;
        const minimapScale = {
            x: this.MINIMAP_WIDTH / ACTUAL_WORLD_WIDTH,
            y: this.MINIMAP_HEIGHT / ACTUAL_WORLD_HEIGHT
        };
        // Draw minimap background (white instead of black)
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.fillRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
        // Draw only walls on minimap
        this.mapData.forEach(element => {
            // Only draw walls
            if (element.type === 'wall') {
                const scaledX = minimapX + (element.x * minimapScale.x);
                const scaledY = minimapY + (element.y * minimapScale.y);
                const scaledWidth = element.width * minimapScale.x;
                const scaledHeight = element.height * minimapScale.y;
                this.ctx.fillStyle = '#000000'; // Black for walls
                this.ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
            }
        });
        // Draw all players on minimap with solid colors
        players.forEach(player => {
            this.ctx.fillStyle = player.id === socket ? '#FF0000' : '#000000'; // Red for current player, black for others
            this.ctx.beginPath();
            this.ctx.arc(minimapX + (player.x * minimapScale.x), minimapY + (player.y * minimapScale.y), 4, // Slightly larger dots
            0, Math.PI * 2);
            this.ctx.fill();
        });
        // Draw viewport rectangle in black
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX + (this.cameraX * minimapScale.x), minimapY + (this.cameraY * minimapScale.y), (this.canvas.width * minimapScale.x), (this.canvas.height * minimapScale.y));
        // Draw border
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX, minimapY, this.MINIMAP_WIDTH, this.MINIMAP_HEIGHT);
    }
    drawGameObjects(players, enemies, items, currentPlayerId, petalExtension = 1.0) {
        const viewport = {
            left: this.cameraX,
            top: this.cameraY,
            right: this.cameraX + this.canvas.width,
            bottom: this.cameraY + this.canvas.height
        };
        // Draw players
        for (const player of players.values()) {
            if (player.x > viewport.left - PLAYER_SIZE && player.x < viewport.right + PLAYER_SIZE &&
                player.y > viewport.top - PLAYER_SIZE && player.y < viewport.bottom + PLAYER_SIZE) {
                this.drawPlayer(player, currentPlayerId, petalExtension);
            }
        }
        // Draw enemies
        for (const enemy of enemies.values()) {
            // Add similar viewport culling for enemies
            this.drawEnemy(enemy);
        }
        // Draw items
        for (const item of items.values()) {
            // Add similar viewport culling for items
            this.drawItem(item);
        }
    }
    render(players, enemies, items, currentPlayerId, petalExtension = 1.0) {
        this.ctx.save();
        // Clear the canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // Apply zoom scaling
        this.ctx.scale(this.zoomLevel, this.zoomLevel);
        // Translate the context by the camera position
        this.ctx.translate(-this.cameraX, -this.cameraY);
        // Draw background pattern
        const pattern = this.ctx.createPattern(this.backgroundTexture, 'repeat');
        if (pattern) {
            this.ctx.fillStyle = pattern;
            this.ctx.fillRect(this.cameraX, this.cameraY, this.canvas.width + this.cameraX * 0.5, this.canvas.height + this.cameraY * 0.5);
        }
        // Draw the map
        this.drawMap(this.mapData);
        // Draw game objects
        this.drawGameObjects(players, enemies, items, currentPlayerId, petalExtension);
        this.ctx.restore();
        // Draw UI elements (not affected by camera)
        this.drawUI(players, currentPlayerId);
    }
    setupItemSprites(itemSprites) {
        this.itemSprites = itemSprites;
    }
    async preloadPetalImages() {
        const { PETAL_CONFIG } = await Promise.resolve(/* import() */).then(__webpack_require__.bind(__webpack_require__, 375));
        const loadPromises = [];
        Object.entries(PETAL_CONFIG).forEach(([petalType, rarities]) => {
            Object.entries(rarities).forEach(([rarity, stats]) => {
                const key = `${petalType}_${rarity}`;
                const img = new Image();
                const promise = new Promise((resolve, reject) => {
                    img.onload = () => {
                        this.petalImageCache[key] = img;
                        resolve();
                    };
                    img.onerror = reject;
                    // Convert SVG string to data URL
                    const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(svgBlob);
                    img.src = url;
                });
                loadPromises.push(promise);
            });
        });
        await Promise.all(loadPromises);
        console.log('All petal images preloaded');
    }
}

;// ./src/chat.ts
class Chat {
    constructor(socket) {
        this.chatContainer = null;
        this.chatInput = null;
        this.chatMessages = null;
        this.isChatFocused = false;
        this.pendingScripts = new Map();
        this.socket = socket;
        this.initialize();
        this.setupSocketListeners();
    }
    // Method to update socket reference (for cross-server transfers)
    updateSocket(newSocket) {
        // Remove old listeners
        this.socket.off('chatMessage');
        this.socket.off('chatHistory');
        // Update socket reference
        this.socket = newSocket;
        // Set up new listeners
        this.setupSocketListeners();
        // Request chat history from new server
        this.socket.emit('requestChatHistory');
        console.log('[CHAT] Socket updated for new server connection');
    }
    setupSocketListeners() {
        this.socket.on('chatMessage', (message) => {
            this.addChatMessage(message);
        });
        this.socket.on('chatHistory', (history) => {
            history.forEach(message => this.addChatMessage(message));
        });
    }
    get isFocused() {
        return this.isChatFocused;
    }
    focus() {
        this.chatInput?.focus();
    }
    blur() {
        this.chatInput?.blur();
    }
    hide() {
        if (this.chatContainer)
            this.chatContainer.style.display = 'none';
    }
    show() {
        if (this.chatContainer)
            this.chatContainer.style.display = 'flex';
    }
    initialize() {
        // Add blink animation style to document
        const style = document.createElement('style');
        style.textContent = `
          @keyframes blink {
              50% { opacity: 0; }
          }
      `;
        document.head.appendChild(style);
        // Create chat container with updated styling
        this.chatContainer = document.createElement('div');
        this.chatContainer.className = 'chat-container';
        this.chatContainer.style.cssText = `
          position: fixed;
          bottom: 10px;
          left: 10px;
          width: 300px;
          height: 200px;
          background: transparent;
          display: flex;
          flex-direction: column;
          z-index: 200;
          font-family: Arial, sans-serif;
      `;
        // Create messages container with transparent background
        this.chatMessages = document.createElement('div');
        this.chatMessages.className = 'chat-messages';
        this.chatMessages.style.cssText = `
          flex-grow: 1;
          overflow-y: auto;
          padding: 5px;
          color: white;
          text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
          background: transparent;
          z-index: 200;
          font-family: Arial, sans-serif;
      `;
        // Create input container
        const inputContainer = document.createElement('div');
        inputContainer.className = 'chat-input-container';
        inputContainer.style.cssText = `
          padding: 5px;
          background: transparent;
          font-family: Arial, sans-serif;
          z-index: 200;
      `;
        // Create input field with semi-transparent background
        this.chatInput = document.createElement('input');
        this.chatInput.type = 'text';
        this.chatInput.placeholder = 'Press Enter to chat...';
        this.chatInput.className = 'chat-input';
        this.chatInput.style.cssText = `
          width: 100%;
          padding: 5px;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 3px;
          background: rgba(0, 0, 0, 0.3);
          color: white;
          outline: none;
          font-family: Arial, sans-serif;
          z-index: 200;
      `;
        // Add event listeners
        this.chatInput.addEventListener('focus', () => {
            this.isChatFocused = true;
            // Make input background slightly more opaque when focused
            this.chatInput.style.background = 'rgba(0, 0, 0, 0.5)';
        });
        this.chatInput.addEventListener('blur', () => {
            this.isChatFocused = false;
            // Restore original transparency when blurred
            this.chatInput.style.background = 'rgba(0, 0, 0, 0.3)';
        });
        // Update the help message to include blink tag
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && this.chatInput?.value.trim()) {
                if (this.chatInput.value.trim().toLowerCase() === '/help') {
                    this.addChatMessage({
                        sender: 'System',
                        content: `Available HTML tags: 
                          <b>bold</b>, 
                          <i>italic</i>, 
                          <u>underline</u>, 
                          <span style="color: red">colored text</span>,
                          <blink>blinking text</blink>,
                          <script>console.log('Hello!')</script> (sandboxed). 
                          Example: Hello <b>world</b> in <span style="color: #ff0000">red</span> and <blink>blinking</blink>!
                          Script example: <script>alert('Hello from script!');</script>`,
                        timestamp: Date.now()
                    });
                    this.chatInput.value = '';
                    return;
                }
                // Send the chat message to the server
                this.socket.emit('chatMessage', this.chatInput.value.trim());
                this.chatInput.value = '';
            }
        });
        this.chatContainer.appendChild(this.chatMessages);
        inputContainer.appendChild(this.chatInput);
        this.chatContainer.appendChild(inputContainer);
        document.body.appendChild(this.chatContainer);
        // Request chat history
        this.socket.emit('requestChatHistory');
    }
    sanitizeHTML(str) {
        // Add 'script' to allowed tags
        const allowedTags = new Set(['b', 'i', 'u', 'strong', 'em', 'span', 'color', 'blink', 'script']);
        const allowedAttributes = new Set(['style', 'color']);
        // Create a temporary div to parse HTML
        const temp = document.createElement('div');
        temp.innerHTML = str;
        // Recursive function to sanitize nodes
        const sanitizeNode = (node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                const tagName = element.tagName.toLowerCase();
                if (tagName === 'script') {
                    // Generate unique ID for this script
                    const scriptId = 'script_' + Math.random().toString(36).substr(2, 9);
                    // Store the script content
                    this.pendingScripts.set(scriptId, {
                        id: scriptId,
                        code: element.textContent || '',
                        sender: 'Unknown' // Updated later
                    });
                    // Replace script with a warning button
                    const warningBtn = document.createElement('button');
                    warningBtn.className = 'script-warning';
                    warningBtn.setAttribute('data-script-id', scriptId);
                    warningBtn.style.cssText = `
                      background: rgba(255, 165, 0, 0.2);
                      border: 1px solid orange;
                      color: white;
                      padding: 2px 5px;
                      border-radius: 3px;
                      cursor: pointer;
                      font-size: 12px;
                      margin: 0 5px;
                  `;
                    warningBtn.textContent = '⚠️ Click to run script';
                    // Replace the script node with our warning button
                    node.parentNode?.replaceChild(warningBtn, node);
                    return;
                }
                // Remove node if tag is not allowed
                if (!allowedTags.has(tagName)) {
                    node.parentNode?.removeChild(node);
                    return;
                }
                // Add blinking animation for blink tag
                if (tagName === 'blink') {
                    element.style.animation = 'blink 1s step-start infinite';
                }
                // Remove disallowed attributes
                Array.from(element.attributes).forEach(attr => {
                    if (!allowedAttributes.has(attr.name.toLowerCase())) {
                        element.removeAttribute(attr.name);
                    }
                });
                // Sanitize style attribute
                const style = element.getAttribute('style');
                if (style) {
                    // Allow color and animation styles
                    const safeStyle = style.split(';')
                        .filter(s => {
                        const prop = s.trim().toLowerCase();
                        return prop.startsWith('color:') || prop.startsWith('animation:');
                    })
                        .join(';');
                    if (safeStyle) {
                        element.setAttribute('style', safeStyle);
                    }
                    else {
                        element.removeAttribute('style');
                    }
                }
                // Recursively sanitize child nodes
                Array.from(node.childNodes).forEach(sanitizeNode);
            }
        };
        // Sanitize all nodes
        Array.from(temp.childNodes).forEach(sanitizeNode);
        return temp.innerHTML;
    }
    createSandbox(script) {
        // Create modal for confirmation
        const modal = document.createElement('div');
        modal.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.9);
          padding: 20px;
          border-radius: 5px;
          border: 1px solid orange;
          color: white;
          z-index: 2000;
          font-family: Arial, sans-serif;
          max-width: 80%;
      `;
        const content = document.createElement('div');
        content.innerHTML = `
          <h3 style="color: orange;">⚠️ Warning: Script Execution</h3>
          <p>Script from user: ${script.sender}</p>
          <pre style="
              background: rgba(255, 255, 255, 0.1);
              padding: 10px;
              border-radius: 3px;
              max-height: 200px;
              overflow-y: auto;
              white-space: pre-wrap;
          ">${script.code}</pre>
          <p style="color: orange;">This script will run in a sandboxed environment with limited capabilities.</p>
      `;
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
          display: flex;
          gap: 10px;
          margin-top: 15px;
          justify-content: center;
      `;
        const runButton = document.createElement('button');
        runButton.textContent = 'Run Script';
        runButton.style.cssText = `
          background: orange;
          color: black;
          border: none;
          padding: 5px 15px;
          border-radius: 3px;
          cursor: pointer;
      `;
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.cssText = `
          background: #666;
          color: white;
          border: none;
          padding: 5px 15px;
          border-radius: 3px;
          cursor: pointer;
      `;
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(runButton);
        modal.appendChild(content);
        modal.appendChild(buttonContainer);
        document.body.appendChild(modal);
        // Handle button clicks
        cancelButton.onclick = () => {
            document.body.removeChild(modal);
        };
        runButton.onclick = () => {
            try {
                // Create sandbox iframe
                const sandbox = document.createElement('iframe');
                sandbox.style.display = 'none';
                document.body.appendChild(sandbox);
                // Create restricted context
                const restrictedWindow = sandbox.contentWindow;
                if (restrictedWindow) {
                    // Define allowed APIs
                    const safeContext = {
                        console: {
                            log: (...args) => {
                                this.addChatMessage({
                                    sender: 'Script Output',
                                    content: args.join(' '),
                                    timestamp: Date.now()
                                });
                            }
                        },
                        alert: (msg) => {
                            this.addChatMessage({
                                sender: 'Script Alert',
                                content: msg,
                                timestamp: Date.now()
                            });
                        },
                        // Add more safe APIs as needed
                    };
                    // Run the script in sandbox using Function constructor instead of eval
                    const wrappedCode = `
                      try {
                          const runScript = new Function('safeContext', 'with (safeContext) { ' + script.code + ' }');
                          runScript(safeContext);
                      } catch (error) {
                          console.log('Script Error:', error.message);
                      }
                  `;
                    // Use Function constructor instead of direct eval
                    const scriptRunner = new Function('safeContext', wrappedCode);
                    scriptRunner(safeContext);
                }
                // Cleanup
                document.body.removeChild(sandbox);
                document.body.removeChild(modal);
            }
            catch (error) {
                this.addChatMessage({
                    sender: 'Script Error',
                    content: `Failed to execute script: ${error}`,
                    timestamp: Date.now()
                });
                document.body.removeChild(modal);
            }
        };
    }
    addChatMessage(message) {
        if (!this.chatMessages)
            return;
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        messageElement.style.cssText = `
          margin: 2px 0;
          font-size: 14px;
          word-wrap: break-word;
          font-family: Arial, sans-serif;
      `;
        const time = new Date(message.timestamp).toLocaleTimeString();
        // Update pending scripts with sender information
        const sanitizedContent = this.sanitizeHTML(message.content);
        this.pendingScripts.forEach(script => {
            script.sender = message.sender;
        });
        messageElement.innerHTML = `
          <span class="chat-time" style="color: rgba(255, 255, 255, 0.6);">[${time}]</span>
          <span class="chat-sender" style="color: #00ff00;">${message.sender}:</span>
          <span style="color: white;">${sanitizedContent}</span>
      `;
        // Add click handlers for script buttons
        messageElement.querySelectorAll('.script-warning').forEach(button => {
            button.addEventListener('click', () => {
                const scriptId = button.getAttribute('data-script-id');
                if (scriptId) {
                    const script = this.pendingScripts.get(scriptId);
                    if (script) {
                        this.createSandbox(script);
                        this.pendingScripts.delete(scriptId);
                    }
                }
            });
        });
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        while (this.chatMessages.children.length > 100) {
            this.chatMessages.removeChild(this.chatMessages.firstChild);
        }
    }
}

;// ./node_modules/engine.io-parser/build/esm/commons.js
const PACKET_TYPES = Object.create(null); // no Map = no polyfill
PACKET_TYPES["open"] = "0";
PACKET_TYPES["close"] = "1";
PACKET_TYPES["ping"] = "2";
PACKET_TYPES["pong"] = "3";
PACKET_TYPES["message"] = "4";
PACKET_TYPES["upgrade"] = "5";
PACKET_TYPES["noop"] = "6";
const PACKET_TYPES_REVERSE = Object.create(null);
Object.keys(PACKET_TYPES).forEach((key) => {
    PACKET_TYPES_REVERSE[PACKET_TYPES[key]] = key;
});
const ERROR_PACKET = { type: "error", data: "parser error" };


;// ./node_modules/engine.io-parser/build/esm/encodePacket.browser.js

const withNativeBlob = typeof Blob === "function" ||
    (typeof Blob !== "undefined" &&
        Object.prototype.toString.call(Blob) === "[object BlobConstructor]");
const withNativeArrayBuffer = typeof ArrayBuffer === "function";
// ArrayBuffer.isView method is not defined in IE10
const isView = (obj) => {
    return typeof ArrayBuffer.isView === "function"
        ? ArrayBuffer.isView(obj)
        : obj && obj.buffer instanceof ArrayBuffer;
};
const encodePacket = ({ type, data }, supportsBinary, callback) => {
    if (withNativeBlob && data instanceof Blob) {
        if (supportsBinary) {
            return callback(data);
        }
        else {
            return encodeBlobAsBase64(data, callback);
        }
    }
    else if (withNativeArrayBuffer &&
        (data instanceof ArrayBuffer || isView(data))) {
        if (supportsBinary) {
            return callback(data);
        }
        else {
            return encodeBlobAsBase64(new Blob([data]), callback);
        }
    }
    // plain string
    return callback(PACKET_TYPES[type] + (data || ""));
};
const encodeBlobAsBase64 = (data, callback) => {
    const fileReader = new FileReader();
    fileReader.onload = function () {
        const content = fileReader.result.split(",")[1];
        callback("b" + (content || ""));
    };
    return fileReader.readAsDataURL(data);
};
function toArray(data) {
    if (data instanceof Uint8Array) {
        return data;
    }
    else if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }
    else {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
}
let TEXT_ENCODER;
function encodePacketToBinary(packet, callback) {
    if (withNativeBlob && packet.data instanceof Blob) {
        return packet.data.arrayBuffer().then(toArray).then(callback);
    }
    else if (withNativeArrayBuffer &&
        (packet.data instanceof ArrayBuffer || isView(packet.data))) {
        return callback(toArray(packet.data));
    }
    encodePacket(packet, false, (encoded) => {
        if (!TEXT_ENCODER) {
            TEXT_ENCODER = new TextEncoder();
        }
        callback(TEXT_ENCODER.encode(encoded));
    });
}


;// ./node_modules/engine.io-parser/build/esm/contrib/base64-arraybuffer.js
// imported from https://github.com/socketio/base64-arraybuffer
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// Use a lookup table to find the index.
const lookup = typeof Uint8Array === 'undefined' ? [] : new Uint8Array(256);
for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
}
const encode = (arraybuffer) => {
    let bytes = new Uint8Array(arraybuffer), i, len = bytes.length, base64 = '';
    for (i = 0; i < len; i += 3) {
        base64 += chars[bytes[i] >> 2];
        base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
        base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
        base64 += chars[bytes[i + 2] & 63];
    }
    if (len % 3 === 2) {
        base64 = base64.substring(0, base64.length - 1) + '=';
    }
    else if (len % 3 === 1) {
        base64 = base64.substring(0, base64.length - 2) + '==';
    }
    return base64;
};
const decode = (base64) => {
    let bufferLength = base64.length * 0.75, len = base64.length, i, p = 0, encoded1, encoded2, encoded3, encoded4;
    if (base64[base64.length - 1] === '=') {
        bufferLength--;
        if (base64[base64.length - 2] === '=') {
            bufferLength--;
        }
    }
    const arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
    for (i = 0; i < len; i += 4) {
        encoded1 = lookup[base64.charCodeAt(i)];
        encoded2 = lookup[base64.charCodeAt(i + 1)];
        encoded3 = lookup[base64.charCodeAt(i + 2)];
        encoded4 = lookup[base64.charCodeAt(i + 3)];
        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
    return arraybuffer;
};

;// ./node_modules/engine.io-parser/build/esm/decodePacket.browser.js


const decodePacket_browser_withNativeArrayBuffer = typeof ArrayBuffer === "function";
const decodePacket = (encodedPacket, binaryType) => {
    if (typeof encodedPacket !== "string") {
        return {
            type: "message",
            data: mapBinary(encodedPacket, binaryType),
        };
    }
    const type = encodedPacket.charAt(0);
    if (type === "b") {
        return {
            type: "message",
            data: decodeBase64Packet(encodedPacket.substring(1), binaryType),
        };
    }
    const packetType = PACKET_TYPES_REVERSE[type];
    if (!packetType) {
        return ERROR_PACKET;
    }
    return encodedPacket.length > 1
        ? {
            type: PACKET_TYPES_REVERSE[type],
            data: encodedPacket.substring(1),
        }
        : {
            type: PACKET_TYPES_REVERSE[type],
        };
};
const decodeBase64Packet = (data, binaryType) => {
    if (decodePacket_browser_withNativeArrayBuffer) {
        const decoded = decode(data);
        return mapBinary(decoded, binaryType);
    }
    else {
        return { base64: true, data }; // fallback for old browsers
    }
};
const mapBinary = (data, binaryType) => {
    switch (binaryType) {
        case "blob":
            if (data instanceof Blob) {
                // from WebSocket + binaryType "blob"
                return data;
            }
            else {
                // from HTTP long-polling or WebTransport
                return new Blob([data]);
            }
        case "arraybuffer":
        default:
            if (data instanceof ArrayBuffer) {
                // from HTTP long-polling (base64) or WebSocket + binaryType "arraybuffer"
                return data;
            }
            else {
                // from WebTransport (Uint8Array)
                return data.buffer;
            }
    }
};

;// ./node_modules/engine.io-parser/build/esm/index.js



const SEPARATOR = String.fromCharCode(30); // see https://en.wikipedia.org/wiki/Delimiter#ASCII_delimited_text
const encodePayload = (packets, callback) => {
    // some packets may be added to the array while encoding, so the initial length must be saved
    const length = packets.length;
    const encodedPackets = new Array(length);
    let count = 0;
    packets.forEach((packet, i) => {
        // force base64 encoding for binary packets
        encodePacket(packet, false, (encodedPacket) => {
            encodedPackets[i] = encodedPacket;
            if (++count === length) {
                callback(encodedPackets.join(SEPARATOR));
            }
        });
    });
};
const decodePayload = (encodedPayload, binaryType) => {
    const encodedPackets = encodedPayload.split(SEPARATOR);
    const packets = [];
    for (let i = 0; i < encodedPackets.length; i++) {
        const decodedPacket = decodePacket(encodedPackets[i], binaryType);
        packets.push(decodedPacket);
        if (decodedPacket.type === "error") {
            break;
        }
    }
    return packets;
};
function createPacketEncoderStream() {
    return new TransformStream({
        transform(packet, controller) {
            encodePacketToBinary(packet, (encodedPacket) => {
                const payloadLength = encodedPacket.length;
                let header;
                // inspired by the WebSocket format: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#decoding_payload_length
                if (payloadLength < 126) {
                    header = new Uint8Array(1);
                    new DataView(header.buffer).setUint8(0, payloadLength);
                }
                else if (payloadLength < 65536) {
                    header = new Uint8Array(3);
                    const view = new DataView(header.buffer);
                    view.setUint8(0, 126);
                    view.setUint16(1, payloadLength);
                }
                else {
                    header = new Uint8Array(9);
                    const view = new DataView(header.buffer);
                    view.setUint8(0, 127);
                    view.setBigUint64(1, BigInt(payloadLength));
                }
                // first bit indicates whether the payload is plain text (0) or binary (1)
                if (packet.data && typeof packet.data !== "string") {
                    header[0] |= 0x80;
                }
                controller.enqueue(header);
                controller.enqueue(encodedPacket);
            });
        },
    });
}
let TEXT_DECODER;
function totalLength(chunks) {
    return chunks.reduce((acc, chunk) => acc + chunk.length, 0);
}
function concatChunks(chunks, size) {
    if (chunks[0].length === size) {
        return chunks.shift();
    }
    const buffer = new Uint8Array(size);
    let j = 0;
    for (let i = 0; i < size; i++) {
        buffer[i] = chunks[0][j++];
        if (j === chunks[0].length) {
            chunks.shift();
            j = 0;
        }
    }
    if (chunks.length && j < chunks[0].length) {
        chunks[0] = chunks[0].slice(j);
    }
    return buffer;
}
function createPacketDecoderStream(maxPayload, binaryType) {
    if (!TEXT_DECODER) {
        TEXT_DECODER = new TextDecoder();
    }
    const chunks = [];
    let state = 0 /* State.READ_HEADER */;
    let expectedLength = -1;
    let isBinary = false;
    return new TransformStream({
        transform(chunk, controller) {
            chunks.push(chunk);
            while (true) {
                if (state === 0 /* State.READ_HEADER */) {
                    if (totalLength(chunks) < 1) {
                        break;
                    }
                    const header = concatChunks(chunks, 1);
                    isBinary = (header[0] & 0x80) === 0x80;
                    expectedLength = header[0] & 0x7f;
                    if (expectedLength < 126) {
                        state = 3 /* State.READ_PAYLOAD */;
                    }
                    else if (expectedLength === 126) {
                        state = 1 /* State.READ_EXTENDED_LENGTH_16 */;
                    }
                    else {
                        state = 2 /* State.READ_EXTENDED_LENGTH_64 */;
                    }
                }
                else if (state === 1 /* State.READ_EXTENDED_LENGTH_16 */) {
                    if (totalLength(chunks) < 2) {
                        break;
                    }
                    const headerArray = concatChunks(chunks, 2);
                    expectedLength = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length).getUint16(0);
                    state = 3 /* State.READ_PAYLOAD */;
                }
                else if (state === 2 /* State.READ_EXTENDED_LENGTH_64 */) {
                    if (totalLength(chunks) < 8) {
                        break;
                    }
                    const headerArray = concatChunks(chunks, 8);
                    const view = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length);
                    const n = view.getUint32(0);
                    if (n > Math.pow(2, 53 - 32) - 1) {
                        // the maximum safe integer in JavaScript is 2^53 - 1
                        controller.enqueue(ERROR_PACKET);
                        break;
                    }
                    expectedLength = n * Math.pow(2, 32) + view.getUint32(4);
                    state = 3 /* State.READ_PAYLOAD */;
                }
                else {
                    if (totalLength(chunks) < expectedLength) {
                        break;
                    }
                    const data = concatChunks(chunks, expectedLength);
                    controller.enqueue(decodePacket(isBinary ? data : TEXT_DECODER.decode(data), binaryType));
                    state = 0 /* State.READ_HEADER */;
                }
                if (expectedLength === 0 || expectedLength > maxPayload) {
                    controller.enqueue(ERROR_PACKET);
                    break;
                }
            }
        },
    });
}
const protocol = 4;


;// ./node_modules/@socket.io/component-emitter/lib/esm/index.js
/**
 * Initialize a new `Emitter`.
 *
 * @api public
 */

function Emitter(obj) {
  if (obj) return mixin(obj);
}

/**
 * Mixin the emitter properties.
 *
 * @param {Object} obj
 * @return {Object}
 * @api private
 */

function mixin(obj) {
  for (var key in Emitter.prototype) {
    obj[key] = Emitter.prototype[key];
  }
  return obj;
}

/**
 * Listen on the given `event` with `fn`.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.on =
Emitter.prototype.addEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};
  (this._callbacks['$' + event] = this._callbacks['$' + event] || [])
    .push(fn);
  return this;
};

/**
 * Adds an `event` listener that will be invoked a single
 * time then automatically removed.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.once = function(event, fn){
  function on() {
    this.off(event, on);
    fn.apply(this, arguments);
  }

  on.fn = fn;
  this.on(event, on);
  return this;
};

/**
 * Remove the given callback for `event` or all
 * registered callbacks.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.off =
Emitter.prototype.removeListener =
Emitter.prototype.removeAllListeners =
Emitter.prototype.removeEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};

  // all
  if (0 == arguments.length) {
    this._callbacks = {};
    return this;
  }

  // specific event
  var callbacks = this._callbacks['$' + event];
  if (!callbacks) return this;

  // remove all handlers
  if (1 == arguments.length) {
    delete this._callbacks['$' + event];
    return this;
  }

  // remove specific handler
  var cb;
  for (var i = 0; i < callbacks.length; i++) {
    cb = callbacks[i];
    if (cb === fn || cb.fn === fn) {
      callbacks.splice(i, 1);
      break;
    }
  }

  // Remove event specific arrays for event types that no
  // one is subscribed for to avoid memory leak.
  if (callbacks.length === 0) {
    delete this._callbacks['$' + event];
  }

  return this;
};

/**
 * Emit `event` with the given args.
 *
 * @param {String} event
 * @param {Mixed} ...
 * @return {Emitter}
 */

Emitter.prototype.emit = function(event){
  this._callbacks = this._callbacks || {};

  var args = new Array(arguments.length - 1)
    , callbacks = this._callbacks['$' + event];

  for (var i = 1; i < arguments.length; i++) {
    args[i - 1] = arguments[i];
  }

  if (callbacks) {
    callbacks = callbacks.slice(0);
    for (var i = 0, len = callbacks.length; i < len; ++i) {
      callbacks[i].apply(this, args);
    }
  }

  return this;
};

// alias used for reserved events (protected method)
Emitter.prototype.emitReserved = Emitter.prototype.emit;

/**
 * Return array of callbacks for `event`.
 *
 * @param {String} event
 * @return {Array}
 * @api public
 */

Emitter.prototype.listeners = function(event){
  this._callbacks = this._callbacks || {};
  return this._callbacks['$' + event] || [];
};

/**
 * Check if this emitter has `event` handlers.
 *
 * @param {String} event
 * @return {Boolean}
 * @api public
 */

Emitter.prototype.hasListeners = function(event){
  return !! this.listeners(event).length;
};

;// ./node_modules/engine.io-client/build/esm/globals.js
const nextTick = (() => {
    const isPromiseAvailable = typeof Promise === "function" && typeof Promise.resolve === "function";
    if (isPromiseAvailable) {
        return (cb) => Promise.resolve().then(cb);
    }
    else {
        return (cb, setTimeoutFn) => setTimeoutFn(cb, 0);
    }
})();
const globalThisShim = (() => {
    if (typeof self !== "undefined") {
        return self;
    }
    else if (typeof window !== "undefined") {
        return window;
    }
    else {
        return Function("return this")();
    }
})();
const defaultBinaryType = "arraybuffer";
function createCookieJar() { }

;// ./node_modules/engine.io-client/build/esm/util.js

function pick(obj, ...attr) {
    return attr.reduce((acc, k) => {
        if (obj.hasOwnProperty(k)) {
            acc[k] = obj[k];
        }
        return acc;
    }, {});
}
// Keep a reference to the real timeout functions so they can be used when overridden
const NATIVE_SET_TIMEOUT = globalThisShim.setTimeout;
const NATIVE_CLEAR_TIMEOUT = globalThisShim.clearTimeout;
function installTimerFunctions(obj, opts) {
    if (opts.useNativeTimers) {
        obj.setTimeoutFn = NATIVE_SET_TIMEOUT.bind(globalThisShim);
        obj.clearTimeoutFn = NATIVE_CLEAR_TIMEOUT.bind(globalThisShim);
    }
    else {
        obj.setTimeoutFn = globalThisShim.setTimeout.bind(globalThisShim);
        obj.clearTimeoutFn = globalThisShim.clearTimeout.bind(globalThisShim);
    }
}
// base64 encoded buffers are about 33% bigger (https://en.wikipedia.org/wiki/Base64)
const BASE64_OVERHEAD = 1.33;
// we could also have used `new Blob([obj]).size`, but it isn't supported in IE9
function byteLength(obj) {
    if (typeof obj === "string") {
        return utf8Length(obj);
    }
    // arraybuffer or blob
    return Math.ceil((obj.byteLength || obj.size) * BASE64_OVERHEAD);
}
function utf8Length(str) {
    let c = 0, length = 0;
    for (let i = 0, l = str.length; i < l; i++) {
        c = str.charCodeAt(i);
        if (c < 0x80) {
            length += 1;
        }
        else if (c < 0x800) {
            length += 2;
        }
        else if (c < 0xd800 || c >= 0xe000) {
            length += 3;
        }
        else {
            i++;
            length += 4;
        }
    }
    return length;
}
/**
 * Generates a random 8-characters string.
 */
function randomString() {
    return (Date.now().toString(36).substring(3) +
        Math.random().toString(36).substring(2, 5));
}

;// ./node_modules/engine.io-client/build/esm/contrib/parseqs.js
// imported from https://github.com/galkn/querystring
/**
 * Compiles a querystring
 * Returns string representation of the object
 *
 * @param {Object}
 * @api private
 */
function parseqs_encode(obj) {
    let str = '';
    for (let i in obj) {
        if (obj.hasOwnProperty(i)) {
            if (str.length)
                str += '&';
            str += encodeURIComponent(i) + '=' + encodeURIComponent(obj[i]);
        }
    }
    return str;
}
/**
 * Parses a simple querystring into an object
 *
 * @param {String} qs
 * @api private
 */
function parseqs_decode(qs) {
    let qry = {};
    let pairs = qs.split('&');
    for (let i = 0, l = pairs.length; i < l; i++) {
        let pair = pairs[i].split('=');
        qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
    }
    return qry;
}

;// ./node_modules/engine.io-client/build/esm/transport.js




class TransportError extends Error {
    constructor(reason, description, context) {
        super(reason);
        this.description = description;
        this.context = context;
        this.type = "TransportError";
    }
}
class Transport extends Emitter {
    /**
     * Transport abstract constructor.
     *
     * @param {Object} opts - options
     * @protected
     */
    constructor(opts) {
        super();
        this.writable = false;
        installTimerFunctions(this, opts);
        this.opts = opts;
        this.query = opts.query;
        this.socket = opts.socket;
        this.supportsBinary = !opts.forceBase64;
    }
    /**
     * Emits an error.
     *
     * @param {String} reason
     * @param description
     * @param context - the error context
     * @return {Transport} for chaining
     * @protected
     */
    onError(reason, description, context) {
        super.emitReserved("error", new TransportError(reason, description, context));
        return this;
    }
    /**
     * Opens the transport.
     */
    open() {
        this.readyState = "opening";
        this.doOpen();
        return this;
    }
    /**
     * Closes the transport.
     */
    close() {
        if (this.readyState === "opening" || this.readyState === "open") {
            this.doClose();
            this.onClose();
        }
        return this;
    }
    /**
     * Sends multiple packets.
     *
     * @param {Array} packets
     */
    send(packets) {
        if (this.readyState === "open") {
            this.write(packets);
        }
        else {
            // this might happen if the transport was silently closed in the beforeunload event handler
        }
    }
    /**
     * Called upon open
     *
     * @protected
     */
    onOpen() {
        this.readyState = "open";
        this.writable = true;
        super.emitReserved("open");
    }
    /**
     * Called with data.
     *
     * @param {String} data
     * @protected
     */
    onData(data) {
        const packet = decodePacket(data, this.socket.binaryType);
        this.onPacket(packet);
    }
    /**
     * Called with a decoded packet.
     *
     * @protected
     */
    onPacket(packet) {
        super.emitReserved("packet", packet);
    }
    /**
     * Called upon close.
     *
     * @protected
     */
    onClose(details) {
        this.readyState = "closed";
        super.emitReserved("close", details);
    }
    /**
     * Pauses the transport, in order not to lose packets during an upgrade.
     *
     * @param onPause
     */
    pause(onPause) { }
    createUri(schema, query = {}) {
        return (schema +
            "://" +
            this._hostname() +
            this._port() +
            this.opts.path +
            this._query(query));
    }
    _hostname() {
        const hostname = this.opts.hostname;
        return hostname.indexOf(":") === -1 ? hostname : "[" + hostname + "]";
    }
    _port() {
        if (this.opts.port &&
            ((this.opts.secure && Number(this.opts.port !== 443)) ||
                (!this.opts.secure && Number(this.opts.port) !== 80))) {
            return ":" + this.opts.port;
        }
        else {
            return "";
        }
    }
    _query(query) {
        const encodedQuery = parseqs_encode(query);
        return encodedQuery.length ? "?" + encodedQuery : "";
    }
}

;// ./node_modules/engine.io-client/build/esm/transports/polling.js



class polling_Polling extends Transport {
    constructor() {
        super(...arguments);
        this._polling = false;
    }
    get name() {
        return "polling";
    }
    /**
     * Opens the socket (triggers polling). We write a PING message to determine
     * when the transport is open.
     *
     * @protected
     */
    doOpen() {
        this._poll();
    }
    /**
     * Pauses polling.
     *
     * @param {Function} onPause - callback upon buffers are flushed and transport is paused
     * @package
     */
    pause(onPause) {
        this.readyState = "pausing";
        const pause = () => {
            this.readyState = "paused";
            onPause();
        };
        if (this._polling || !this.writable) {
            let total = 0;
            if (this._polling) {
                total++;
                this.once("pollComplete", function () {
                    --total || pause();
                });
            }
            if (!this.writable) {
                total++;
                this.once("drain", function () {
                    --total || pause();
                });
            }
        }
        else {
            pause();
        }
    }
    /**
     * Starts polling cycle.
     *
     * @private
     */
    _poll() {
        this._polling = true;
        this.doPoll();
        this.emitReserved("poll");
    }
    /**
     * Overloads onData to detect payloads.
     *
     * @protected
     */
    onData(data) {
        const callback = (packet) => {
            // if its the first message we consider the transport open
            if ("opening" === this.readyState && packet.type === "open") {
                this.onOpen();
            }
            // if its a close packet, we close the ongoing requests
            if ("close" === packet.type) {
                this.onClose({ description: "transport closed by the server" });
                return false;
            }
            // otherwise bypass onData and handle the message
            this.onPacket(packet);
        };
        // decode payload
        decodePayload(data, this.socket.binaryType).forEach(callback);
        // if an event did not trigger closing
        if ("closed" !== this.readyState) {
            // if we got data we're not polling
            this._polling = false;
            this.emitReserved("pollComplete");
            if ("open" === this.readyState) {
                this._poll();
            }
            else {
            }
        }
    }
    /**
     * For polling, send a close packet.
     *
     * @protected
     */
    doClose() {
        const close = () => {
            this.write([{ type: "close" }]);
        };
        if ("open" === this.readyState) {
            close();
        }
        else {
            // in case we're trying to close while
            // handshaking is in progress (GH-164)
            this.once("open", close);
        }
    }
    /**
     * Writes a packets payload.
     *
     * @param {Array} packets - data packets
     * @protected
     */
    write(packets) {
        this.writable = false;
        encodePayload(packets, (data) => {
            this.doWrite(data, () => {
                this.writable = true;
                this.emitReserved("drain");
            });
        });
    }
    /**
     * Generates uri for connection.
     *
     * @private
     */
    uri() {
        const schema = this.opts.secure ? "https" : "http";
        const query = this.query || {};
        // cache busting is forced
        if (false !== this.opts.timestampRequests) {
            query[this.opts.timestampParam] = randomString();
        }
        if (!this.supportsBinary && !query.sid) {
            query.b64 = 1;
        }
        return this.createUri(schema, query);
    }
}

;// ./node_modules/engine.io-client/build/esm/contrib/has-cors.js
// imported from https://github.com/component/has-cors
let value = false;
try {
    value = typeof XMLHttpRequest !== 'undefined' &&
        'withCredentials' in new XMLHttpRequest();
}
catch (err) {
    // if XMLHttp support is disabled in IE then it will throw
    // when trying to create
}
const hasCORS = value;

;// ./node_modules/engine.io-client/build/esm/transports/polling-xhr.js





function empty() { }
class BaseXHR extends polling_Polling {
    /**
     * XHR Polling constructor.
     *
     * @param {Object} opts
     * @package
     */
    constructor(opts) {
        super(opts);
        if (typeof location !== "undefined") {
            const isSSL = "https:" === location.protocol;
            let port = location.port;
            // some user agents have empty `location.port`
            if (!port) {
                port = isSSL ? "443" : "80";
            }
            this.xd =
                (typeof location !== "undefined" &&
                    opts.hostname !== location.hostname) ||
                    port !== opts.port;
        }
    }
    /**
     * Sends data.
     *
     * @param {String} data to send.
     * @param {Function} called upon flush.
     * @private
     */
    doWrite(data, fn) {
        const req = this.request({
            method: "POST",
            data: data,
        });
        req.on("success", fn);
        req.on("error", (xhrStatus, context) => {
            this.onError("xhr post error", xhrStatus, context);
        });
    }
    /**
     * Starts a poll cycle.
     *
     * @private
     */
    doPoll() {
        const req = this.request();
        req.on("data", this.onData.bind(this));
        req.on("error", (xhrStatus, context) => {
            this.onError("xhr poll error", xhrStatus, context);
        });
        this.pollXhr = req;
    }
}
class Request extends Emitter {
    /**
     * Request constructor
     *
     * @param {Object} options
     * @package
     */
    constructor(createRequest, uri, opts) {
        super();
        this.createRequest = createRequest;
        installTimerFunctions(this, opts);
        this._opts = opts;
        this._method = opts.method || "GET";
        this._uri = uri;
        this._data = undefined !== opts.data ? opts.data : null;
        this._create();
    }
    /**
     * Creates the XHR object and sends the request.
     *
     * @private
     */
    _create() {
        var _a;
        const opts = pick(this._opts, "agent", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "autoUnref");
        opts.xdomain = !!this._opts.xd;
        const xhr = (this._xhr = this.createRequest(opts));
        try {
            xhr.open(this._method, this._uri, true);
            try {
                if (this._opts.extraHeaders) {
                    // @ts-ignore
                    xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
                    for (let i in this._opts.extraHeaders) {
                        if (this._opts.extraHeaders.hasOwnProperty(i)) {
                            xhr.setRequestHeader(i, this._opts.extraHeaders[i]);
                        }
                    }
                }
            }
            catch (e) { }
            if ("POST" === this._method) {
                try {
                    xhr.setRequestHeader("Content-type", "text/plain;charset=UTF-8");
                }
                catch (e) { }
            }
            try {
                xhr.setRequestHeader("Accept", "*/*");
            }
            catch (e) { }
            (_a = this._opts.cookieJar) === null || _a === void 0 ? void 0 : _a.addCookies(xhr);
            // ie6 check
            if ("withCredentials" in xhr) {
                xhr.withCredentials = this._opts.withCredentials;
            }
            if (this._opts.requestTimeout) {
                xhr.timeout = this._opts.requestTimeout;
            }
            xhr.onreadystatechange = () => {
                var _a;
                if (xhr.readyState === 3) {
                    (_a = this._opts.cookieJar) === null || _a === void 0 ? void 0 : _a.parseCookies(
                    // @ts-ignore
                    xhr.getResponseHeader("set-cookie"));
                }
                if (4 !== xhr.readyState)
                    return;
                if (200 === xhr.status || 1223 === xhr.status) {
                    this._onLoad();
                }
                else {
                    // make sure the `error` event handler that's user-set
                    // does not throw in the same tick and gets caught here
                    this.setTimeoutFn(() => {
                        this._onError(typeof xhr.status === "number" ? xhr.status : 0);
                    }, 0);
                }
            };
            xhr.send(this._data);
        }
        catch (e) {
            // Need to defer since .create() is called directly from the constructor
            // and thus the 'error' event can only be only bound *after* this exception
            // occurs.  Therefore, also, we cannot throw here at all.
            this.setTimeoutFn(() => {
                this._onError(e);
            }, 0);
            return;
        }
        if (typeof document !== "undefined") {
            this._index = Request.requestsCount++;
            Request.requests[this._index] = this;
        }
    }
    /**
     * Called upon error.
     *
     * @private
     */
    _onError(err) {
        this.emitReserved("error", err, this._xhr);
        this._cleanup(true);
    }
    /**
     * Cleans up house.
     *
     * @private
     */
    _cleanup(fromError) {
        if ("undefined" === typeof this._xhr || null === this._xhr) {
            return;
        }
        this._xhr.onreadystatechange = empty;
        if (fromError) {
            try {
                this._xhr.abort();
            }
            catch (e) { }
        }
        if (typeof document !== "undefined") {
            delete Request.requests[this._index];
        }
        this._xhr = null;
    }
    /**
     * Called upon load.
     *
     * @private
     */
    _onLoad() {
        const data = this._xhr.responseText;
        if (data !== null) {
            this.emitReserved("data", data);
            this.emitReserved("success");
            this._cleanup();
        }
    }
    /**
     * Aborts the request.
     *
     * @package
     */
    abort() {
        this._cleanup();
    }
}
Request.requestsCount = 0;
Request.requests = {};
/**
 * Aborts pending requests when unloading the window. This is needed to prevent
 * memory leaks (e.g. when using IE) and to ensure that no spurious error is
 * emitted.
 */
if (typeof document !== "undefined") {
    // @ts-ignore
    if (typeof attachEvent === "function") {
        // @ts-ignore
        attachEvent("onunload", unloadHandler);
    }
    else if (typeof addEventListener === "function") {
        const terminationEvent = "onpagehide" in globalThisShim ? "pagehide" : "unload";
        addEventListener(terminationEvent, unloadHandler, false);
    }
}
function unloadHandler() {
    for (let i in Request.requests) {
        if (Request.requests.hasOwnProperty(i)) {
            Request.requests[i].abort();
        }
    }
}
const hasXHR2 = (function () {
    const xhr = newRequest({
        xdomain: false,
    });
    return xhr && xhr.responseType !== null;
})();
/**
 * HTTP long-polling based on the built-in `XMLHttpRequest` object.
 *
 * Usage: browser
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest
 */
class XHR extends BaseXHR {
    constructor(opts) {
        super(opts);
        const forceBase64 = opts && opts.forceBase64;
        this.supportsBinary = hasXHR2 && !forceBase64;
    }
    request(opts = {}) {
        Object.assign(opts, { xd: this.xd }, this.opts);
        return new Request(newRequest, this.uri(), opts);
    }
}
function newRequest(opts) {
    const xdomain = opts.xdomain;
    // XMLHttpRequest can be disabled on IE
    try {
        if ("undefined" !== typeof XMLHttpRequest && (!xdomain || hasCORS)) {
            return new XMLHttpRequest();
        }
    }
    catch (e) { }
    if (!xdomain) {
        try {
            return new globalThisShim[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP");
        }
        catch (e) { }
    }
}

;// ./node_modules/engine.io-client/build/esm/transports/websocket.js




// detect ReactNative environment
const isReactNative = typeof navigator !== "undefined" &&
    typeof navigator.product === "string" &&
    navigator.product.toLowerCase() === "reactnative";
class BaseWS extends Transport {
    get name() {
        return "websocket";
    }
    doOpen() {
        const uri = this.uri();
        const protocols = this.opts.protocols;
        // React Native only supports the 'headers' option, and will print a warning if anything else is passed
        const opts = isReactNative
            ? {}
            : pick(this.opts, "agent", "perMessageDeflate", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "localAddress", "protocolVersion", "origin", "maxPayload", "family", "checkServerIdentity");
        if (this.opts.extraHeaders) {
            opts.headers = this.opts.extraHeaders;
        }
        try {
            this.ws = this.createSocket(uri, protocols, opts);
        }
        catch (err) {
            return this.emitReserved("error", err);
        }
        this.ws.binaryType = this.socket.binaryType;
        this.addEventListeners();
    }
    /**
     * Adds event listeners to the socket
     *
     * @private
     */
    addEventListeners() {
        this.ws.onopen = () => {
            if (this.opts.autoUnref) {
                this.ws._socket.unref();
            }
            this.onOpen();
        };
        this.ws.onclose = (closeEvent) => this.onClose({
            description: "websocket connection closed",
            context: closeEvent,
        });
        this.ws.onmessage = (ev) => this.onData(ev.data);
        this.ws.onerror = (e) => this.onError("websocket error", e);
    }
    write(packets) {
        this.writable = false;
        // encodePacket efficient as it uses WS framing
        // no need for encodePayload
        for (let i = 0; i < packets.length; i++) {
            const packet = packets[i];
            const lastPacket = i === packets.length - 1;
            encodePacket(packet, this.supportsBinary, (data) => {
                // Sometimes the websocket has already been closed but the browser didn't
                // have a chance of informing us about it yet, in that case send will
                // throw an error
                try {
                    this.doWrite(packet, data);
                }
                catch (e) {
                }
                if (lastPacket) {
                    // fake drain
                    // defer to next tick to allow Socket to clear writeBuffer
                    nextTick(() => {
                        this.writable = true;
                        this.emitReserved("drain");
                    }, this.setTimeoutFn);
                }
            });
        }
    }
    doClose() {
        if (typeof this.ws !== "undefined") {
            this.ws.onerror = () => { };
            this.ws.close();
            this.ws = null;
        }
    }
    /**
     * Generates uri for connection.
     *
     * @private
     */
    uri() {
        const schema = this.opts.secure ? "wss" : "ws";
        const query = this.query || {};
        // append timestamp to URI
        if (this.opts.timestampRequests) {
            query[this.opts.timestampParam] = randomString();
        }
        // communicate binary support capabilities
        if (!this.supportsBinary) {
            query.b64 = 1;
        }
        return this.createUri(schema, query);
    }
}
const WebSocketCtor = globalThisShim.WebSocket || globalThisShim.MozWebSocket;
/**
 * WebSocket transport based on the built-in `WebSocket` object.
 *
 * Usage: browser, Node.js (since v21), Deno, Bun
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
 * @see https://caniuse.com/mdn-api_websocket
 * @see https://nodejs.org/api/globals.html#websocket
 */
class WS extends BaseWS {
    createSocket(uri, protocols, opts) {
        return !isReactNative
            ? protocols
                ? new WebSocketCtor(uri, protocols)
                : new WebSocketCtor(uri)
            : new WebSocketCtor(uri, protocols, opts);
    }
    doWrite(_packet, data) {
        this.ws.send(data);
    }
}

;// ./node_modules/engine.io-client/build/esm/transports/webtransport.js



/**
 * WebTransport transport based on the built-in `WebTransport` object.
 *
 * Usage: browser, Node.js (with the `@fails-components/webtransport` package)
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebTransport
 * @see https://caniuse.com/webtransport
 */
class WT extends Transport {
    get name() {
        return "webtransport";
    }
    doOpen() {
        try {
            // @ts-ignore
            this._transport = new WebTransport(this.createUri("https"), this.opts.transportOptions[this.name]);
        }
        catch (err) {
            return this.emitReserved("error", err);
        }
        this._transport.closed
            .then(() => {
            this.onClose();
        })
            .catch((err) => {
            this.onError("webtransport error", err);
        });
        // note: we could have used async/await, but that would require some additional polyfills
        this._transport.ready.then(() => {
            this._transport.createBidirectionalStream().then((stream) => {
                const decoderStream = createPacketDecoderStream(Number.MAX_SAFE_INTEGER, this.socket.binaryType);
                const reader = stream.readable.pipeThrough(decoderStream).getReader();
                const encoderStream = createPacketEncoderStream();
                encoderStream.readable.pipeTo(stream.writable);
                this._writer = encoderStream.writable.getWriter();
                const read = () => {
                    reader
                        .read()
                        .then(({ done, value }) => {
                        if (done) {
                            return;
                        }
                        this.onPacket(value);
                        read();
                    })
                        .catch((err) => {
                    });
                };
                read();
                const packet = { type: "open" };
                if (this.query.sid) {
                    packet.data = `{"sid":"${this.query.sid}"}`;
                }
                this._writer.write(packet).then(() => this.onOpen());
            });
        });
    }
    write(packets) {
        this.writable = false;
        for (let i = 0; i < packets.length; i++) {
            const packet = packets[i];
            const lastPacket = i === packets.length - 1;
            this._writer.write(packet).then(() => {
                if (lastPacket) {
                    nextTick(() => {
                        this.writable = true;
                        this.emitReserved("drain");
                    }, this.setTimeoutFn);
                }
            });
        }
    }
    doClose() {
        var _a;
        (_a = this._transport) === null || _a === void 0 ? void 0 : _a.close();
    }
}

;// ./node_modules/engine.io-client/build/esm/transports/index.js



const transports = {
    websocket: WS,
    webtransport: WT,
    polling: XHR,
};

;// ./node_modules/engine.io-client/build/esm/contrib/parseuri.js
// imported from https://github.com/galkn/parseuri
/**
 * Parses a URI
 *
 * Note: we could also have used the built-in URL object, but it isn't supported on all platforms.
 *
 * See:
 * - https://developer.mozilla.org/en-US/docs/Web/API/URL
 * - https://caniuse.com/url
 * - https://www.rfc-editor.org/rfc/rfc3986#appendix-B
 *
 * History of the parse() method:
 * - first commit: https://github.com/socketio/socket.io-client/commit/4ee1d5d94b3906a9c052b459f1a818b15f38f91c
 * - export into its own module: https://github.com/socketio/engine.io-client/commit/de2c561e4564efeb78f1bdb1ba39ef81b2822cb3
 * - reimport: https://github.com/socketio/engine.io-client/commit/df32277c3f6d622eec5ed09f493cae3f3391d242
 *
 * @author Steven Levithan <stevenlevithan.com> (MIT license)
 * @api private
 */
const re = /^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;
const parts = [
    'source', 'protocol', 'authority', 'userInfo', 'user', 'password', 'host', 'port', 'relative', 'path', 'directory', 'file', 'query', 'anchor'
];
function parse(str) {
    if (str.length > 8000) {
        throw "URI too long";
    }
    const src = str, b = str.indexOf('['), e = str.indexOf(']');
    if (b != -1 && e != -1) {
        str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ';') + str.substring(e, str.length);
    }
    let m = re.exec(str || ''), uri = {}, i = 14;
    while (i--) {
        uri[parts[i]] = m[i] || '';
    }
    if (b != -1 && e != -1) {
        uri.source = src;
        uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ':');
        uri.authority = uri.authority.replace('[', '').replace(']', '').replace(/;/g, ':');
        uri.ipv6uri = true;
    }
    uri.pathNames = pathNames(uri, uri['path']);
    uri.queryKey = queryKey(uri, uri['query']);
    return uri;
}
function pathNames(obj, path) {
    const regx = /\/{2,9}/g, names = path.replace(regx, "/").split("/");
    if (path.slice(0, 1) == '/' || path.length === 0) {
        names.splice(0, 1);
    }
    if (path.slice(-1) == '/') {
        names.splice(names.length - 1, 1);
    }
    return names;
}
function queryKey(uri, query) {
    const data = {};
    query.replace(/(?:^|&)([^&=]*)=?([^&]*)/g, function ($0, $1, $2) {
        if ($1) {
            data[$1] = $2;
        }
    });
    return data;
}

;// ./node_modules/engine.io-client/build/esm/socket.js







const withEventListeners = typeof addEventListener === "function" &&
    typeof removeEventListener === "function";
const OFFLINE_EVENT_LISTENERS = [];
if (withEventListeners) {
    // within a ServiceWorker, any event handler for the 'offline' event must be added on the initial evaluation of the
    // script, so we create one single event listener here which will forward the event to the socket instances
    addEventListener("offline", () => {
        OFFLINE_EVENT_LISTENERS.forEach((listener) => listener());
    }, false);
}
/**
 * This class provides a WebSocket-like interface to connect to an Engine.IO server. The connection will be established
 * with one of the available low-level transports, like HTTP long-polling, WebSocket or WebTransport.
 *
 * This class comes without upgrade mechanism, which means that it will keep the first low-level transport that
 * successfully establishes the connection.
 *
 * In order to allow tree-shaking, there are no transports included, that's why the `transports` option is mandatory.
 *
 * @example
 * import { SocketWithoutUpgrade, WebSocket } from "engine.io-client";
 *
 * const socket = new SocketWithoutUpgrade({
 *   transports: [WebSocket]
 * });
 *
 * socket.on("open", () => {
 *   socket.send("hello");
 * });
 *
 * @see SocketWithUpgrade
 * @see Socket
 */
class SocketWithoutUpgrade extends Emitter {
    /**
     * Socket constructor.
     *
     * @param {String|Object} uri - uri or options
     * @param {Object} opts - options
     */
    constructor(uri, opts) {
        super();
        this.binaryType = defaultBinaryType;
        this.writeBuffer = [];
        this._prevBufferLen = 0;
        this._pingInterval = -1;
        this._pingTimeout = -1;
        this._maxPayload = -1;
        /**
         * The expiration timestamp of the {@link _pingTimeoutTimer} object is tracked, in case the timer is throttled and the
         * callback is not fired on time. This can happen for example when a laptop is suspended or when a phone is locked.
         */
        this._pingTimeoutTime = Infinity;
        if (uri && "object" === typeof uri) {
            opts = uri;
            uri = null;
        }
        if (uri) {
            const parsedUri = parse(uri);
            opts.hostname = parsedUri.host;
            opts.secure =
                parsedUri.protocol === "https" || parsedUri.protocol === "wss";
            opts.port = parsedUri.port;
            if (parsedUri.query)
                opts.query = parsedUri.query;
        }
        else if (opts.host) {
            opts.hostname = parse(opts.host).host;
        }
        installTimerFunctions(this, opts);
        this.secure =
            null != opts.secure
                ? opts.secure
                : typeof location !== "undefined" && "https:" === location.protocol;
        if (opts.hostname && !opts.port) {
            // if no port is specified manually, use the protocol default
            opts.port = this.secure ? "443" : "80";
        }
        this.hostname =
            opts.hostname ||
                (typeof location !== "undefined" ? location.hostname : "localhost");
        this.port =
            opts.port ||
                (typeof location !== "undefined" && location.port
                    ? location.port
                    : this.secure
                        ? "443"
                        : "80");
        this.transports = [];
        this._transportsByName = {};
        opts.transports.forEach((t) => {
            const transportName = t.prototype.name;
            this.transports.push(transportName);
            this._transportsByName[transportName] = t;
        });
        this.opts = Object.assign({
            path: "/engine.io",
            agent: false,
            withCredentials: false,
            upgrade: true,
            timestampParam: "t",
            rememberUpgrade: false,
            addTrailingSlash: true,
            rejectUnauthorized: true,
            perMessageDeflate: {
                threshold: 1024,
            },
            transportOptions: {},
            closeOnBeforeunload: false,
        }, opts);
        this.opts.path =
            this.opts.path.replace(/\/$/, "") +
                (this.opts.addTrailingSlash ? "/" : "");
        if (typeof this.opts.query === "string") {
            this.opts.query = parseqs_decode(this.opts.query);
        }
        if (withEventListeners) {
            if (this.opts.closeOnBeforeunload) {
                // Firefox closes the connection when the "beforeunload" event is emitted but not Chrome. This event listener
                // ensures every browser behaves the same (no "disconnect" event at the Socket.IO level when the page is
                // closed/reloaded)
                this._beforeunloadEventListener = () => {
                    if (this.transport) {
                        // silently close the transport
                        this.transport.removeAllListeners();
                        this.transport.close();
                    }
                };
                addEventListener("beforeunload", this._beforeunloadEventListener, false);
            }
            if (this.hostname !== "localhost") {
                this._offlineEventListener = () => {
                    this._onClose("transport close", {
                        description: "network connection lost",
                    });
                };
                OFFLINE_EVENT_LISTENERS.push(this._offlineEventListener);
            }
        }
        if (this.opts.withCredentials) {
            this._cookieJar = createCookieJar();
        }
        this._open();
    }
    /**
     * Creates transport of the given type.
     *
     * @param {String} name - transport name
     * @return {Transport}
     * @private
     */
    createTransport(name) {
        const query = Object.assign({}, this.opts.query);
        // append engine.io protocol identifier
        query.EIO = protocol;
        // transport name
        query.transport = name;
        // session id if we already have one
        if (this.id)
            query.sid = this.id;
        const opts = Object.assign({}, this.opts, {
            query,
            socket: this,
            hostname: this.hostname,
            secure: this.secure,
            port: this.port,
        }, this.opts.transportOptions[name]);
        return new this._transportsByName[name](opts);
    }
    /**
     * Initializes transport to use and starts probe.
     *
     * @private
     */
    _open() {
        if (this.transports.length === 0) {
            // Emit error on next tick so it can be listened to
            this.setTimeoutFn(() => {
                this.emitReserved("error", "No transports available");
            }, 0);
            return;
        }
        const transportName = this.opts.rememberUpgrade &&
            SocketWithoutUpgrade.priorWebsocketSuccess &&
            this.transports.indexOf("websocket") !== -1
            ? "websocket"
            : this.transports[0];
        this.readyState = "opening";
        const transport = this.createTransport(transportName);
        transport.open();
        this.setTransport(transport);
    }
    /**
     * Sets the current transport. Disables the existing one (if any).
     *
     * @private
     */
    setTransport(transport) {
        if (this.transport) {
            this.transport.removeAllListeners();
        }
        // set up transport
        this.transport = transport;
        // set up transport listeners
        transport
            .on("drain", this._onDrain.bind(this))
            .on("packet", this._onPacket.bind(this))
            .on("error", this._onError.bind(this))
            .on("close", (reason) => this._onClose("transport close", reason));
    }
    /**
     * Called when connection is deemed open.
     *
     * @private
     */
    onOpen() {
        this.readyState = "open";
        SocketWithoutUpgrade.priorWebsocketSuccess =
            "websocket" === this.transport.name;
        this.emitReserved("open");
        this.flush();
    }
    /**
     * Handles a packet.
     *
     * @private
     */
    _onPacket(packet) {
        if ("opening" === this.readyState ||
            "open" === this.readyState ||
            "closing" === this.readyState) {
            this.emitReserved("packet", packet);
            // Socket is live - any packet counts
            this.emitReserved("heartbeat");
            switch (packet.type) {
                case "open":
                    this.onHandshake(JSON.parse(packet.data));
                    break;
                case "ping":
                    this._sendPacket("pong");
                    this.emitReserved("ping");
                    this.emitReserved("pong");
                    this._resetPingTimeout();
                    break;
                case "error":
                    const err = new Error("server error");
                    // @ts-ignore
                    err.code = packet.data;
                    this._onError(err);
                    break;
                case "message":
                    this.emitReserved("data", packet.data);
                    this.emitReserved("message", packet.data);
                    break;
            }
        }
        else {
        }
    }
    /**
     * Called upon handshake completion.
     *
     * @param {Object} data - handshake obj
     * @private
     */
    onHandshake(data) {
        this.emitReserved("handshake", data);
        this.id = data.sid;
        this.transport.query.sid = data.sid;
        this._pingInterval = data.pingInterval;
        this._pingTimeout = data.pingTimeout;
        this._maxPayload = data.maxPayload;
        this.onOpen();
        // In case open handler closes socket
        if ("closed" === this.readyState)
            return;
        this._resetPingTimeout();
    }
    /**
     * Sets and resets ping timeout timer based on server pings.
     *
     * @private
     */
    _resetPingTimeout() {
        this.clearTimeoutFn(this._pingTimeoutTimer);
        const delay = this._pingInterval + this._pingTimeout;
        this._pingTimeoutTime = Date.now() + delay;
        this._pingTimeoutTimer = this.setTimeoutFn(() => {
            this._onClose("ping timeout");
        }, delay);
        if (this.opts.autoUnref) {
            this._pingTimeoutTimer.unref();
        }
    }
    /**
     * Called on `drain` event
     *
     * @private
     */
    _onDrain() {
        this.writeBuffer.splice(0, this._prevBufferLen);
        // setting prevBufferLen = 0 is very important
        // for example, when upgrading, upgrade packet is sent over,
        // and a nonzero prevBufferLen could cause problems on `drain`
        this._prevBufferLen = 0;
        if (0 === this.writeBuffer.length) {
            this.emitReserved("drain");
        }
        else {
            this.flush();
        }
    }
    /**
     * Flush write buffers.
     *
     * @private
     */
    flush() {
        if ("closed" !== this.readyState &&
            this.transport.writable &&
            !this.upgrading &&
            this.writeBuffer.length) {
            const packets = this._getWritablePackets();
            this.transport.send(packets);
            // keep track of current length of writeBuffer
            // splice writeBuffer and callbackBuffer on `drain`
            this._prevBufferLen = packets.length;
            this.emitReserved("flush");
        }
    }
    /**
     * Ensure the encoded size of the writeBuffer is below the maxPayload value sent by the server (only for HTTP
     * long-polling)
     *
     * @private
     */
    _getWritablePackets() {
        const shouldCheckPayloadSize = this._maxPayload &&
            this.transport.name === "polling" &&
            this.writeBuffer.length > 1;
        if (!shouldCheckPayloadSize) {
            return this.writeBuffer;
        }
        let payloadSize = 1; // first packet type
        for (let i = 0; i < this.writeBuffer.length; i++) {
            const data = this.writeBuffer[i].data;
            if (data) {
                payloadSize += byteLength(data);
            }
            if (i > 0 && payloadSize > this._maxPayload) {
                return this.writeBuffer.slice(0, i);
            }
            payloadSize += 2; // separator + packet type
        }
        return this.writeBuffer;
    }
    /**
     * Checks whether the heartbeat timer has expired but the socket has not yet been notified.
     *
     * Note: this method is private for now because it does not really fit the WebSocket API, but if we put it in the
     * `write()` method then the message would not be buffered by the Socket.IO client.
     *
     * @return {boolean}
     * @private
     */
    /* private */ _hasPingExpired() {
        if (!this._pingTimeoutTime)
            return true;
        const hasExpired = Date.now() > this._pingTimeoutTime;
        if (hasExpired) {
            this._pingTimeoutTime = 0;
            nextTick(() => {
                this._onClose("ping timeout");
            }, this.setTimeoutFn);
        }
        return hasExpired;
    }
    /**
     * Sends a message.
     *
     * @param {String} msg - message.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @return {Socket} for chaining.
     */
    write(msg, options, fn) {
        this._sendPacket("message", msg, options, fn);
        return this;
    }
    /**
     * Sends a message. Alias of {@link Socket#write}.
     *
     * @param {String} msg - message.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @return {Socket} for chaining.
     */
    send(msg, options, fn) {
        this._sendPacket("message", msg, options, fn);
        return this;
    }
    /**
     * Sends a packet.
     *
     * @param {String} type: packet type.
     * @param {String} data.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @private
     */
    _sendPacket(type, data, options, fn) {
        if ("function" === typeof data) {
            fn = data;
            data = undefined;
        }
        if ("function" === typeof options) {
            fn = options;
            options = null;
        }
        if ("closing" === this.readyState || "closed" === this.readyState) {
            return;
        }
        options = options || {};
        options.compress = false !== options.compress;
        const packet = {
            type: type,
            data: data,
            options: options,
        };
        this.emitReserved("packetCreate", packet);
        this.writeBuffer.push(packet);
        if (fn)
            this.once("flush", fn);
        this.flush();
    }
    /**
     * Closes the connection.
     */
    close() {
        const close = () => {
            this._onClose("forced close");
            this.transport.close();
        };
        const cleanupAndClose = () => {
            this.off("upgrade", cleanupAndClose);
            this.off("upgradeError", cleanupAndClose);
            close();
        };
        const waitForUpgrade = () => {
            // wait for upgrade to finish since we can't send packets while pausing a transport
            this.once("upgrade", cleanupAndClose);
            this.once("upgradeError", cleanupAndClose);
        };
        if ("opening" === this.readyState || "open" === this.readyState) {
            this.readyState = "closing";
            if (this.writeBuffer.length) {
                this.once("drain", () => {
                    if (this.upgrading) {
                        waitForUpgrade();
                    }
                    else {
                        close();
                    }
                });
            }
            else if (this.upgrading) {
                waitForUpgrade();
            }
            else {
                close();
            }
        }
        return this;
    }
    /**
     * Called upon transport error
     *
     * @private
     */
    _onError(err) {
        SocketWithoutUpgrade.priorWebsocketSuccess = false;
        if (this.opts.tryAllTransports &&
            this.transports.length > 1 &&
            this.readyState === "opening") {
            this.transports.shift();
            return this._open();
        }
        this.emitReserved("error", err);
        this._onClose("transport error", err);
    }
    /**
     * Called upon transport close.
     *
     * @private
     */
    _onClose(reason, description) {
        if ("opening" === this.readyState ||
            "open" === this.readyState ||
            "closing" === this.readyState) {
            // clear timers
            this.clearTimeoutFn(this._pingTimeoutTimer);
            // stop event from firing again for transport
            this.transport.removeAllListeners("close");
            // ensure transport won't stay open
            this.transport.close();
            // ignore further transport communication
            this.transport.removeAllListeners();
            if (withEventListeners) {
                if (this._beforeunloadEventListener) {
                    removeEventListener("beforeunload", this._beforeunloadEventListener, false);
                }
                if (this._offlineEventListener) {
                    const i = OFFLINE_EVENT_LISTENERS.indexOf(this._offlineEventListener);
                    if (i !== -1) {
                        OFFLINE_EVENT_LISTENERS.splice(i, 1);
                    }
                }
            }
            // set ready state
            this.readyState = "closed";
            // clear session id
            this.id = null;
            // emit close event
            this.emitReserved("close", reason, description);
            // clean buffers after, so users can still
            // grab the buffers on `close` event
            this.writeBuffer = [];
            this._prevBufferLen = 0;
        }
    }
}
SocketWithoutUpgrade.protocol = protocol;
/**
 * This class provides a WebSocket-like interface to connect to an Engine.IO server. The connection will be established
 * with one of the available low-level transports, like HTTP long-polling, WebSocket or WebTransport.
 *
 * This class comes with an upgrade mechanism, which means that once the connection is established with the first
 * low-level transport, it will try to upgrade to a better transport.
 *
 * In order to allow tree-shaking, there are no transports included, that's why the `transports` option is mandatory.
 *
 * @example
 * import { SocketWithUpgrade, WebSocket } from "engine.io-client";
 *
 * const socket = new SocketWithUpgrade({
 *   transports: [WebSocket]
 * });
 *
 * socket.on("open", () => {
 *   socket.send("hello");
 * });
 *
 * @see SocketWithoutUpgrade
 * @see Socket
 */
class SocketWithUpgrade extends SocketWithoutUpgrade {
    constructor() {
        super(...arguments);
        this._upgrades = [];
    }
    onOpen() {
        super.onOpen();
        if ("open" === this.readyState && this.opts.upgrade) {
            for (let i = 0; i < this._upgrades.length; i++) {
                this._probe(this._upgrades[i]);
            }
        }
    }
    /**
     * Probes a transport.
     *
     * @param {String} name - transport name
     * @private
     */
    _probe(name) {
        let transport = this.createTransport(name);
        let failed = false;
        SocketWithoutUpgrade.priorWebsocketSuccess = false;
        const onTransportOpen = () => {
            if (failed)
                return;
            transport.send([{ type: "ping", data: "probe" }]);
            transport.once("packet", (msg) => {
                if (failed)
                    return;
                if ("pong" === msg.type && "probe" === msg.data) {
                    this.upgrading = true;
                    this.emitReserved("upgrading", transport);
                    if (!transport)
                        return;
                    SocketWithoutUpgrade.priorWebsocketSuccess =
                        "websocket" === transport.name;
                    this.transport.pause(() => {
                        if (failed)
                            return;
                        if ("closed" === this.readyState)
                            return;
                        cleanup();
                        this.setTransport(transport);
                        transport.send([{ type: "upgrade" }]);
                        this.emitReserved("upgrade", transport);
                        transport = null;
                        this.upgrading = false;
                        this.flush();
                    });
                }
                else {
                    const err = new Error("probe error");
                    // @ts-ignore
                    err.transport = transport.name;
                    this.emitReserved("upgradeError", err);
                }
            });
        };
        function freezeTransport() {
            if (failed)
                return;
            // Any callback called by transport should be ignored since now
            failed = true;
            cleanup();
            transport.close();
            transport = null;
        }
        // Handle any error that happens while probing
        const onerror = (err) => {
            const error = new Error("probe error: " + err);
            // @ts-ignore
            error.transport = transport.name;
            freezeTransport();
            this.emitReserved("upgradeError", error);
        };
        function onTransportClose() {
            onerror("transport closed");
        }
        // When the socket is closed while we're probing
        function onclose() {
            onerror("socket closed");
        }
        // When the socket is upgraded while we're probing
        function onupgrade(to) {
            if (transport && to.name !== transport.name) {
                freezeTransport();
            }
        }
        // Remove all listeners on the transport and on self
        const cleanup = () => {
            transport.removeListener("open", onTransportOpen);
            transport.removeListener("error", onerror);
            transport.removeListener("close", onTransportClose);
            this.off("close", onclose);
            this.off("upgrading", onupgrade);
        };
        transport.once("open", onTransportOpen);
        transport.once("error", onerror);
        transport.once("close", onTransportClose);
        this.once("close", onclose);
        this.once("upgrading", onupgrade);
        if (this._upgrades.indexOf("webtransport") !== -1 &&
            name !== "webtransport") {
            // favor WebTransport
            this.setTimeoutFn(() => {
                if (!failed) {
                    transport.open();
                }
            }, 200);
        }
        else {
            transport.open();
        }
    }
    onHandshake(data) {
        this._upgrades = this._filterUpgrades(data.upgrades);
        super.onHandshake(data);
    }
    /**
     * Filters upgrades, returning only those matching client transports.
     *
     * @param {Array} upgrades - server upgrades
     * @private
     */
    _filterUpgrades(upgrades) {
        const filteredUpgrades = [];
        for (let i = 0; i < upgrades.length; i++) {
            if (~this.transports.indexOf(upgrades[i]))
                filteredUpgrades.push(upgrades[i]);
        }
        return filteredUpgrades;
    }
}
/**
 * This class provides a WebSocket-like interface to connect to an Engine.IO server. The connection will be established
 * with one of the available low-level transports, like HTTP long-polling, WebSocket or WebTransport.
 *
 * This class comes with an upgrade mechanism, which means that once the connection is established with the first
 * low-level transport, it will try to upgrade to a better transport.
 *
 * @example
 * import { Socket } from "engine.io-client";
 *
 * const socket = new Socket();
 *
 * socket.on("open", () => {
 *   socket.send("hello");
 * });
 *
 * @see SocketWithoutUpgrade
 * @see SocketWithUpgrade
 */
class Socket extends SocketWithUpgrade {
    constructor(uri, opts = {}) {
        const o = typeof uri === "object" ? uri : opts;
        if (!o.transports ||
            (o.transports && typeof o.transports[0] === "string")) {
            o.transports = (o.transports || ["polling", "websocket", "webtransport"])
                .map((transportName) => transports[transportName])
                .filter((t) => !!t);
        }
        super(uri, o);
    }
}

;// ./node_modules/engine.io-client/build/esm/transports/polling-fetch.js

/**
 * HTTP long-polling based on the built-in `fetch()` method.
 *
 * Usage: browser, Node.js (since v18), Deno, Bun
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/fetch
 * @see https://caniuse.com/fetch
 * @see https://nodejs.org/api/globals.html#fetch
 */
class Fetch extends (/* unused pure expression or super */ null && (Polling)) {
    doPoll() {
        this._fetch()
            .then((res) => {
            if (!res.ok) {
                return this.onError("fetch read error", res.status, res);
            }
            res.text().then((data) => this.onData(data));
        })
            .catch((err) => {
            this.onError("fetch read error", err);
        });
    }
    doWrite(data, callback) {
        this._fetch(data)
            .then((res) => {
            if (!res.ok) {
                return this.onError("fetch write error", res.status, res);
            }
            callback();
        })
            .catch((err) => {
            this.onError("fetch write error", err);
        });
    }
    _fetch(data) {
        var _a;
        const isPost = data !== undefined;
        const headers = new Headers(this.opts.extraHeaders);
        if (isPost) {
            headers.set("content-type", "text/plain;charset=UTF-8");
        }
        (_a = this.socket._cookieJar) === null || _a === void 0 ? void 0 : _a.appendCookies(headers);
        return fetch(this.uri(), {
            method: isPost ? "POST" : "GET",
            body: isPost ? data : null,
            headers,
            credentials: this.opts.withCredentials ? "include" : "omit",
        }).then((res) => {
            var _a;
            // @ts-ignore getSetCookie() was added in Node.js v19.7.0
            (_a = this.socket._cookieJar) === null || _a === void 0 ? void 0 : _a.parseCookies(res.headers.getSetCookie());
            return res;
        });
    }
}

;// ./node_modules/engine.io-client/build/esm/index.js



const esm_protocol = Socket.protocol;












;// ./node_modules/socket.io-client/build/esm/url.js

/**
 * URL parser.
 *
 * @param uri - url
 * @param path - the request path of the connection
 * @param loc - An object meant to mimic window.location.
 *        Defaults to window.location.
 * @public
 */
function url(uri, path = "", loc) {
    let obj = uri;
    // default to window.location
    loc = loc || (typeof location !== "undefined" && location);
    if (null == uri)
        uri = loc.protocol + "//" + loc.host;
    // relative path support
    if (typeof uri === "string") {
        if ("/" === uri.charAt(0)) {
            if ("/" === uri.charAt(1)) {
                uri = loc.protocol + uri;
            }
            else {
                uri = loc.host + uri;
            }
        }
        if (!/^(https?|wss?):\/\//.test(uri)) {
            if ("undefined" !== typeof loc) {
                uri = loc.protocol + "//" + uri;
            }
            else {
                uri = "https://" + uri;
            }
        }
        // parse
        obj = parse(uri);
    }
    // make sure we treat `localhost:80` and `localhost` equally
    if (!obj.port) {
        if (/^(http|ws)$/.test(obj.protocol)) {
            obj.port = "80";
        }
        else if (/^(http|ws)s$/.test(obj.protocol)) {
            obj.port = "443";
        }
    }
    obj.path = obj.path || "/";
    const ipv6 = obj.host.indexOf(":") !== -1;
    const host = ipv6 ? "[" + obj.host + "]" : obj.host;
    // define unique id
    obj.id = obj.protocol + "://" + host + ":" + obj.port + path;
    // define href
    obj.href =
        obj.protocol +
            "://" +
            host +
            (loc && loc.port === obj.port ? "" : ":" + obj.port);
    return obj;
}

;// ./node_modules/socket.io-parser/build/esm/is-binary.js
const is_binary_withNativeArrayBuffer = typeof ArrayBuffer === "function";
const is_binary_isView = (obj) => {
    return typeof ArrayBuffer.isView === "function"
        ? ArrayBuffer.isView(obj)
        : obj.buffer instanceof ArrayBuffer;
};
const is_binary_toString = Object.prototype.toString;
const is_binary_withNativeBlob = typeof Blob === "function" ||
    (typeof Blob !== "undefined" &&
        is_binary_toString.call(Blob) === "[object BlobConstructor]");
const withNativeFile = typeof File === "function" ||
    (typeof File !== "undefined" &&
        is_binary_toString.call(File) === "[object FileConstructor]");
/**
 * Returns true if obj is a Buffer, an ArrayBuffer, a Blob or a File.
 *
 * @private
 */
function isBinary(obj) {
    return ((is_binary_withNativeArrayBuffer && (obj instanceof ArrayBuffer || is_binary_isView(obj))) ||
        (is_binary_withNativeBlob && obj instanceof Blob) ||
        (withNativeFile && obj instanceof File));
}
function hasBinary(obj, toJSON) {
    if (!obj || typeof obj !== "object") {
        return false;
    }
    if (Array.isArray(obj)) {
        for (let i = 0, l = obj.length; i < l; i++) {
            if (hasBinary(obj[i])) {
                return true;
            }
        }
        return false;
    }
    if (isBinary(obj)) {
        return true;
    }
    if (obj.toJSON &&
        typeof obj.toJSON === "function" &&
        arguments.length === 1) {
        return hasBinary(obj.toJSON(), true);
    }
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
            return true;
        }
    }
    return false;
}

;// ./node_modules/socket.io-parser/build/esm/binary.js

/**
 * Replaces every Buffer | ArrayBuffer | Blob | File in packet with a numbered placeholder.
 *
 * @param {Object} packet - socket.io event packet
 * @return {Object} with deconstructed packet and list of buffers
 * @public
 */
function deconstructPacket(packet) {
    const buffers = [];
    const packetData = packet.data;
    const pack = packet;
    pack.data = _deconstructPacket(packetData, buffers);
    pack.attachments = buffers.length; // number of binary 'attachments'
    return { packet: pack, buffers: buffers };
}
function _deconstructPacket(data, buffers) {
    if (!data)
        return data;
    if (isBinary(data)) {
        const placeholder = { _placeholder: true, num: buffers.length };
        buffers.push(data);
        return placeholder;
    }
    else if (Array.isArray(data)) {
        const newData = new Array(data.length);
        for (let i = 0; i < data.length; i++) {
            newData[i] = _deconstructPacket(data[i], buffers);
        }
        return newData;
    }
    else if (typeof data === "object" && !(data instanceof Date)) {
        const newData = {};
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                newData[key] = _deconstructPacket(data[key], buffers);
            }
        }
        return newData;
    }
    return data;
}
/**
 * Reconstructs a binary packet from its placeholder packet and buffers
 *
 * @param {Object} packet - event packet with placeholders
 * @param {Array} buffers - binary buffers to put in placeholder positions
 * @return {Object} reconstructed packet
 * @public
 */
function reconstructPacket(packet, buffers) {
    packet.data = _reconstructPacket(packet.data, buffers);
    delete packet.attachments; // no longer useful
    return packet;
}
function _reconstructPacket(data, buffers) {
    if (!data)
        return data;
    if (data && data._placeholder === true) {
        const isIndexValid = typeof data.num === "number" &&
            data.num >= 0 &&
            data.num < buffers.length;
        if (isIndexValid) {
            return buffers[data.num]; // appropriate buffer (should be natural order anyway)
        }
        else {
            throw new Error("illegal attachments");
        }
    }
    else if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
            data[i] = _reconstructPacket(data[i], buffers);
        }
    }
    else if (typeof data === "object") {
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                data[key] = _reconstructPacket(data[key], buffers);
            }
        }
    }
    return data;
}

;// ./node_modules/socket.io-parser/build/esm/index.js



/**
 * These strings must not be used as event names, as they have a special meaning.
 */
const RESERVED_EVENTS = [
    "connect",
    "connect_error",
    "disconnect",
    "disconnecting",
    "newListener",
    "removeListener", // used by the Node.js EventEmitter
];
/**
 * Protocol version.
 *
 * @public
 */
const build_esm_protocol = 5;
var PacketType;
(function (PacketType) {
    PacketType[PacketType["CONNECT"] = 0] = "CONNECT";
    PacketType[PacketType["DISCONNECT"] = 1] = "DISCONNECT";
    PacketType[PacketType["EVENT"] = 2] = "EVENT";
    PacketType[PacketType["ACK"] = 3] = "ACK";
    PacketType[PacketType["CONNECT_ERROR"] = 4] = "CONNECT_ERROR";
    PacketType[PacketType["BINARY_EVENT"] = 5] = "BINARY_EVENT";
    PacketType[PacketType["BINARY_ACK"] = 6] = "BINARY_ACK";
})(PacketType || (PacketType = {}));
/**
 * A socket.io Encoder instance
 */
class Encoder {
    /**
     * Encoder constructor
     *
     * @param {function} replacer - custom replacer to pass down to JSON.parse
     */
    constructor(replacer) {
        this.replacer = replacer;
    }
    /**
     * Encode a packet as a single string if non-binary, or as a
     * buffer sequence, depending on packet type.
     *
     * @param {Object} obj - packet object
     */
    encode(obj) {
        if (obj.type === PacketType.EVENT || obj.type === PacketType.ACK) {
            if (hasBinary(obj)) {
                return this.encodeAsBinary({
                    type: obj.type === PacketType.EVENT
                        ? PacketType.BINARY_EVENT
                        : PacketType.BINARY_ACK,
                    nsp: obj.nsp,
                    data: obj.data,
                    id: obj.id,
                });
            }
        }
        return [this.encodeAsString(obj)];
    }
    /**
     * Encode packet as string.
     */
    encodeAsString(obj) {
        // first is type
        let str = "" + obj.type;
        // attachments if we have them
        if (obj.type === PacketType.BINARY_EVENT ||
            obj.type === PacketType.BINARY_ACK) {
            str += obj.attachments + "-";
        }
        // if we have a namespace other than `/`
        // we append it followed by a comma `,`
        if (obj.nsp && "/" !== obj.nsp) {
            str += obj.nsp + ",";
        }
        // immediately followed by the id
        if (null != obj.id) {
            str += obj.id;
        }
        // json data
        if (null != obj.data) {
            str += JSON.stringify(obj.data, this.replacer);
        }
        return str;
    }
    /**
     * Encode packet as 'buffer sequence' by removing blobs, and
     * deconstructing packet into object with placeholders and
     * a list of buffers.
     */
    encodeAsBinary(obj) {
        const deconstruction = deconstructPacket(obj);
        const pack = this.encodeAsString(deconstruction.packet);
        const buffers = deconstruction.buffers;
        buffers.unshift(pack); // add packet info to beginning of data list
        return buffers; // write all the buffers
    }
}
// see https://stackoverflow.com/questions/8511281/check-if-a-value-is-an-object-in-javascript
function isObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}
/**
 * A socket.io Decoder instance
 *
 * @return {Object} decoder
 */
class Decoder extends Emitter {
    /**
     * Decoder constructor
     *
     * @param {function} reviver - custom reviver to pass down to JSON.stringify
     */
    constructor(reviver) {
        super();
        this.reviver = reviver;
    }
    /**
     * Decodes an encoded packet string into packet JSON.
     *
     * @param {String} obj - encoded packet
     */
    add(obj) {
        let packet;
        if (typeof obj === "string") {
            if (this.reconstructor) {
                throw new Error("got plaintext data when reconstructing a packet");
            }
            packet = this.decodeString(obj);
            const isBinaryEvent = packet.type === PacketType.BINARY_EVENT;
            if (isBinaryEvent || packet.type === PacketType.BINARY_ACK) {
                packet.type = isBinaryEvent ? PacketType.EVENT : PacketType.ACK;
                // binary packet's json
                this.reconstructor = new BinaryReconstructor(packet);
                // no attachments, labeled binary but no binary data to follow
                if (packet.attachments === 0) {
                    super.emitReserved("decoded", packet);
                }
            }
            else {
                // non-binary full packet
                super.emitReserved("decoded", packet);
            }
        }
        else if (isBinary(obj) || obj.base64) {
            // raw binary data
            if (!this.reconstructor) {
                throw new Error("got binary data when not reconstructing a packet");
            }
            else {
                packet = this.reconstructor.takeBinaryData(obj);
                if (packet) {
                    // received final buffer
                    this.reconstructor = null;
                    super.emitReserved("decoded", packet);
                }
            }
        }
        else {
            throw new Error("Unknown type: " + obj);
        }
    }
    /**
     * Decode a packet String (JSON data)
     *
     * @param {String} str
     * @return {Object} packet
     */
    decodeString(str) {
        let i = 0;
        // look up type
        const p = {
            type: Number(str.charAt(0)),
        };
        if (PacketType[p.type] === undefined) {
            throw new Error("unknown packet type " + p.type);
        }
        // look up attachments if type binary
        if (p.type === PacketType.BINARY_EVENT ||
            p.type === PacketType.BINARY_ACK) {
            const start = i + 1;
            while (str.charAt(++i) !== "-" && i != str.length) { }
            const buf = str.substring(start, i);
            if (buf != Number(buf) || str.charAt(i) !== "-") {
                throw new Error("Illegal attachments");
            }
            p.attachments = Number(buf);
        }
        // look up namespace (if any)
        if ("/" === str.charAt(i + 1)) {
            const start = i + 1;
            while (++i) {
                const c = str.charAt(i);
                if ("," === c)
                    break;
                if (i === str.length)
                    break;
            }
            p.nsp = str.substring(start, i);
        }
        else {
            p.nsp = "/";
        }
        // look up id
        const next = str.charAt(i + 1);
        if ("" !== next && Number(next) == next) {
            const start = i + 1;
            while (++i) {
                const c = str.charAt(i);
                if (null == c || Number(c) != c) {
                    --i;
                    break;
                }
                if (i === str.length)
                    break;
            }
            p.id = Number(str.substring(start, i + 1));
        }
        // look up json data
        if (str.charAt(++i)) {
            const payload = this.tryParse(str.substr(i));
            if (Decoder.isPayloadValid(p.type, payload)) {
                p.data = payload;
            }
            else {
                throw new Error("invalid payload");
            }
        }
        return p;
    }
    tryParse(str) {
        try {
            return JSON.parse(str, this.reviver);
        }
        catch (e) {
            return false;
        }
    }
    static isPayloadValid(type, payload) {
        switch (type) {
            case PacketType.CONNECT:
                return isObject(payload);
            case PacketType.DISCONNECT:
                return payload === undefined;
            case PacketType.CONNECT_ERROR:
                return typeof payload === "string" || isObject(payload);
            case PacketType.EVENT:
            case PacketType.BINARY_EVENT:
                return (Array.isArray(payload) &&
                    (typeof payload[0] === "number" ||
                        (typeof payload[0] === "string" &&
                            RESERVED_EVENTS.indexOf(payload[0]) === -1)));
            case PacketType.ACK:
            case PacketType.BINARY_ACK:
                return Array.isArray(payload);
        }
    }
    /**
     * Deallocates a parser's resources
     */
    destroy() {
        if (this.reconstructor) {
            this.reconstructor.finishedReconstruction();
            this.reconstructor = null;
        }
    }
}
/**
 * A manager of a binary event's 'buffer sequence'. Should
 * be constructed whenever a packet of type BINARY_EVENT is
 * decoded.
 *
 * @param {Object} packet
 * @return {BinaryReconstructor} initialized reconstructor
 */
class BinaryReconstructor {
    constructor(packet) {
        this.packet = packet;
        this.buffers = [];
        this.reconPack = packet;
    }
    /**
     * Method to be called when binary data received from connection
     * after a BINARY_EVENT packet.
     *
     * @param {Buffer | ArrayBuffer} binData - the raw binary data received
     * @return {null | Object} returns null if more binary data is expected or
     *   a reconstructed packet object if all buffers have been received.
     */
    takeBinaryData(binData) {
        this.buffers.push(binData);
        if (this.buffers.length === this.reconPack.attachments) {
            // done with buffer list
            const packet = reconstructPacket(this.reconPack, this.buffers);
            this.finishedReconstruction();
            return packet;
        }
        return null;
    }
    /**
     * Cleans up binary packet reconstruction variables.
     */
    finishedReconstruction() {
        this.reconPack = null;
        this.buffers = [];
    }
}

;// ./node_modules/socket.io-client/build/esm/on.js
function on(obj, ev, fn) {
    obj.on(ev, fn);
    return function subDestroy() {
        obj.off(ev, fn);
    };
}

;// ./node_modules/socket.io-client/build/esm/socket.js



/**
 * Internal events.
 * These events can't be emitted by the user.
 */
const socket_RESERVED_EVENTS = Object.freeze({
    connect: 1,
    connect_error: 1,
    disconnect: 1,
    disconnecting: 1,
    // EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
    newListener: 1,
    removeListener: 1,
});
/**
 * A Socket is the fundamental class for interacting with the server.
 *
 * A Socket belongs to a certain Namespace (by default /) and uses an underlying {@link Manager} to communicate.
 *
 * @example
 * const socket = io();
 *
 * socket.on("connect", () => {
 *   console.log("connected");
 * });
 *
 * // send an event to the server
 * socket.emit("foo", "bar");
 *
 * socket.on("foobar", () => {
 *   // an event was received from the server
 * });
 *
 * // upon disconnection
 * socket.on("disconnect", (reason) => {
 *   console.log(`disconnected due to ${reason}`);
 * });
 */
class socket_Socket extends Emitter {
    /**
     * `Socket` constructor.
     */
    constructor(io, nsp, opts) {
        super();
        /**
         * Whether the socket is currently connected to the server.
         *
         * @example
         * const socket = io();
         *
         * socket.on("connect", () => {
         *   console.log(socket.connected); // true
         * });
         *
         * socket.on("disconnect", () => {
         *   console.log(socket.connected); // false
         * });
         */
        this.connected = false;
        /**
         * Whether the connection state was recovered after a temporary disconnection. In that case, any missed packets will
         * be transmitted by the server.
         */
        this.recovered = false;
        /**
         * Buffer for packets received before the CONNECT packet
         */
        this.receiveBuffer = [];
        /**
         * Buffer for packets that will be sent once the socket is connected
         */
        this.sendBuffer = [];
        /**
         * The queue of packets to be sent with retry in case of failure.
         *
         * Packets are sent one by one, each waiting for the server acknowledgement, in order to guarantee the delivery order.
         * @private
         */
        this._queue = [];
        /**
         * A sequence to generate the ID of the {@link QueuedPacket}.
         * @private
         */
        this._queueSeq = 0;
        this.ids = 0;
        /**
         * A map containing acknowledgement handlers.
         *
         * The `withError` attribute is used to differentiate handlers that accept an error as first argument:
         *
         * - `socket.emit("test", (err, value) => { ... })` with `ackTimeout` option
         * - `socket.timeout(5000).emit("test", (err, value) => { ... })`
         * - `const value = await socket.emitWithAck("test")`
         *
         * From those that don't:
         *
         * - `socket.emit("test", (value) => { ... });`
         *
         * In the first case, the handlers will be called with an error when:
         *
         * - the timeout is reached
         * - the socket gets disconnected
         *
         * In the second case, the handlers will be simply discarded upon disconnection, since the client will never receive
         * an acknowledgement from the server.
         *
         * @private
         */
        this.acks = {};
        this.flags = {};
        this.io = io;
        this.nsp = nsp;
        if (opts && opts.auth) {
            this.auth = opts.auth;
        }
        this._opts = Object.assign({}, opts);
        if (this.io._autoConnect)
            this.open();
    }
    /**
     * Whether the socket is currently disconnected
     *
     * @example
     * const socket = io();
     *
     * socket.on("connect", () => {
     *   console.log(socket.disconnected); // false
     * });
     *
     * socket.on("disconnect", () => {
     *   console.log(socket.disconnected); // true
     * });
     */
    get disconnected() {
        return !this.connected;
    }
    /**
     * Subscribe to open, close and packet events
     *
     * @private
     */
    subEvents() {
        if (this.subs)
            return;
        const io = this.io;
        this.subs = [
            on(io, "open", this.onopen.bind(this)),
            on(io, "packet", this.onpacket.bind(this)),
            on(io, "error", this.onerror.bind(this)),
            on(io, "close", this.onclose.bind(this)),
        ];
    }
    /**
     * Whether the Socket will try to reconnect when its Manager connects or reconnects.
     *
     * @example
     * const socket = io();
     *
     * console.log(socket.active); // true
     *
     * socket.on("disconnect", (reason) => {
     *   if (reason === "io server disconnect") {
     *     // the disconnection was initiated by the server, you need to manually reconnect
     *     console.log(socket.active); // false
     *   }
     *   // else the socket will automatically try to reconnect
     *   console.log(socket.active); // true
     * });
     */
    get active() {
        return !!this.subs;
    }
    /**
     * "Opens" the socket.
     *
     * @example
     * const socket = io({
     *   autoConnect: false
     * });
     *
     * socket.connect();
     */
    connect() {
        if (this.connected)
            return this;
        this.subEvents();
        if (!this.io["_reconnecting"])
            this.io.open(); // ensure open
        if ("open" === this.io._readyState)
            this.onopen();
        return this;
    }
    /**
     * Alias for {@link connect()}.
     */
    open() {
        return this.connect();
    }
    /**
     * Sends a `message` event.
     *
     * This method mimics the WebSocket.send() method.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
     *
     * @example
     * socket.send("hello");
     *
     * // this is equivalent to
     * socket.emit("message", "hello");
     *
     * @return self
     */
    send(...args) {
        args.unshift("message");
        this.emit.apply(this, args);
        return this;
    }
    /**
     * Override `emit`.
     * If the event is in `events`, it's emitted normally.
     *
     * @example
     * socket.emit("hello", "world");
     *
     * // all serializable datastructures are supported (no need to call JSON.stringify)
     * socket.emit("hello", 1, "2", { 3: ["4"], 5: Uint8Array.from([6]) });
     *
     * // with an acknowledgement from the server
     * socket.emit("hello", "world", (val) => {
     *   // ...
     * });
     *
     * @return self
     */
    emit(ev, ...args) {
        var _a, _b, _c;
        if (socket_RESERVED_EVENTS.hasOwnProperty(ev)) {
            throw new Error('"' + ev.toString() + '" is a reserved event name');
        }
        args.unshift(ev);
        if (this._opts.retries && !this.flags.fromQueue && !this.flags.volatile) {
            this._addToQueue(args);
            return this;
        }
        const packet = {
            type: PacketType.EVENT,
            data: args,
        };
        packet.options = {};
        packet.options.compress = this.flags.compress !== false;
        // event ack callback
        if ("function" === typeof args[args.length - 1]) {
            const id = this.ids++;
            const ack = args.pop();
            this._registerAckCallback(id, ack);
            packet.id = id;
        }
        const isTransportWritable = (_b = (_a = this.io.engine) === null || _a === void 0 ? void 0 : _a.transport) === null || _b === void 0 ? void 0 : _b.writable;
        const isConnected = this.connected && !((_c = this.io.engine) === null || _c === void 0 ? void 0 : _c._hasPingExpired());
        const discardPacket = this.flags.volatile && !isTransportWritable;
        if (discardPacket) {
        }
        else if (isConnected) {
            this.notifyOutgoingListeners(packet);
            this.packet(packet);
        }
        else {
            this.sendBuffer.push(packet);
        }
        this.flags = {};
        return this;
    }
    /**
     * @private
     */
    _registerAckCallback(id, ack) {
        var _a;
        const timeout = (_a = this.flags.timeout) !== null && _a !== void 0 ? _a : this._opts.ackTimeout;
        if (timeout === undefined) {
            this.acks[id] = ack;
            return;
        }
        // @ts-ignore
        const timer = this.io.setTimeoutFn(() => {
            delete this.acks[id];
            for (let i = 0; i < this.sendBuffer.length; i++) {
                if (this.sendBuffer[i].id === id) {
                    this.sendBuffer.splice(i, 1);
                }
            }
            ack.call(this, new Error("operation has timed out"));
        }, timeout);
        const fn = (...args) => {
            // @ts-ignore
            this.io.clearTimeoutFn(timer);
            ack.apply(this, args);
        };
        fn.withError = true;
        this.acks[id] = fn;
    }
    /**
     * Emits an event and waits for an acknowledgement
     *
     * @example
     * // without timeout
     * const response = await socket.emitWithAck("hello", "world");
     *
     * // with a specific timeout
     * try {
     *   const response = await socket.timeout(1000).emitWithAck("hello", "world");
     * } catch (err) {
     *   // the server did not acknowledge the event in the given delay
     * }
     *
     * @return a Promise that will be fulfilled when the server acknowledges the event
     */
    emitWithAck(ev, ...args) {
        return new Promise((resolve, reject) => {
            const fn = (arg1, arg2) => {
                return arg1 ? reject(arg1) : resolve(arg2);
            };
            fn.withError = true;
            args.push(fn);
            this.emit(ev, ...args);
        });
    }
    /**
     * Add the packet to the queue.
     * @param args
     * @private
     */
    _addToQueue(args) {
        let ack;
        if (typeof args[args.length - 1] === "function") {
            ack = args.pop();
        }
        const packet = {
            id: this._queueSeq++,
            tryCount: 0,
            pending: false,
            args,
            flags: Object.assign({ fromQueue: true }, this.flags),
        };
        args.push((err, ...responseArgs) => {
            if (packet !== this._queue[0]) {
                // the packet has already been acknowledged
                return;
            }
            const hasError = err !== null;
            if (hasError) {
                if (packet.tryCount > this._opts.retries) {
                    this._queue.shift();
                    if (ack) {
                        ack(err);
                    }
                }
            }
            else {
                this._queue.shift();
                if (ack) {
                    ack(null, ...responseArgs);
                }
            }
            packet.pending = false;
            return this._drainQueue();
        });
        this._queue.push(packet);
        this._drainQueue();
    }
    /**
     * Send the first packet of the queue, and wait for an acknowledgement from the server.
     * @param force - whether to resend a packet that has not been acknowledged yet
     *
     * @private
     */
    _drainQueue(force = false) {
        if (!this.connected || this._queue.length === 0) {
            return;
        }
        const packet = this._queue[0];
        if (packet.pending && !force) {
            return;
        }
        packet.pending = true;
        packet.tryCount++;
        this.flags = packet.flags;
        this.emit.apply(this, packet.args);
    }
    /**
     * Sends a packet.
     *
     * @param packet
     * @private
     */
    packet(packet) {
        packet.nsp = this.nsp;
        this.io._packet(packet);
    }
    /**
     * Called upon engine `open`.
     *
     * @private
     */
    onopen() {
        if (typeof this.auth == "function") {
            this.auth((data) => {
                this._sendConnectPacket(data);
            });
        }
        else {
            this._sendConnectPacket(this.auth);
        }
    }
    /**
     * Sends a CONNECT packet to initiate the Socket.IO session.
     *
     * @param data
     * @private
     */
    _sendConnectPacket(data) {
        this.packet({
            type: PacketType.CONNECT,
            data: this._pid
                ? Object.assign({ pid: this._pid, offset: this._lastOffset }, data)
                : data,
        });
    }
    /**
     * Called upon engine or manager `error`.
     *
     * @param err
     * @private
     */
    onerror(err) {
        if (!this.connected) {
            this.emitReserved("connect_error", err);
        }
    }
    /**
     * Called upon engine `close`.
     *
     * @param reason
     * @param description
     * @private
     */
    onclose(reason, description) {
        this.connected = false;
        delete this.id;
        this.emitReserved("disconnect", reason, description);
        this._clearAcks();
    }
    /**
     * Clears the acknowledgement handlers upon disconnection, since the client will never receive an acknowledgement from
     * the server.
     *
     * @private
     */
    _clearAcks() {
        Object.keys(this.acks).forEach((id) => {
            const isBuffered = this.sendBuffer.some((packet) => String(packet.id) === id);
            if (!isBuffered) {
                // note: handlers that do not accept an error as first argument are ignored here
                const ack = this.acks[id];
                delete this.acks[id];
                if (ack.withError) {
                    ack.call(this, new Error("socket has been disconnected"));
                }
            }
        });
    }
    /**
     * Called with socket packet.
     *
     * @param packet
     * @private
     */
    onpacket(packet) {
        const sameNamespace = packet.nsp === this.nsp;
        if (!sameNamespace)
            return;
        switch (packet.type) {
            case PacketType.CONNECT:
                if (packet.data && packet.data.sid) {
                    this.onconnect(packet.data.sid, packet.data.pid);
                }
                else {
                    this.emitReserved("connect_error", new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));
                }
                break;
            case PacketType.EVENT:
            case PacketType.BINARY_EVENT:
                this.onevent(packet);
                break;
            case PacketType.ACK:
            case PacketType.BINARY_ACK:
                this.onack(packet);
                break;
            case PacketType.DISCONNECT:
                this.ondisconnect();
                break;
            case PacketType.CONNECT_ERROR:
                this.destroy();
                const err = new Error(packet.data.message);
                // @ts-ignore
                err.data = packet.data.data;
                this.emitReserved("connect_error", err);
                break;
        }
    }
    /**
     * Called upon a server event.
     *
     * @param packet
     * @private
     */
    onevent(packet) {
        const args = packet.data || [];
        if (null != packet.id) {
            args.push(this.ack(packet.id));
        }
        if (this.connected) {
            this.emitEvent(args);
        }
        else {
            this.receiveBuffer.push(Object.freeze(args));
        }
    }
    emitEvent(args) {
        if (this._anyListeners && this._anyListeners.length) {
            const listeners = this._anyListeners.slice();
            for (const listener of listeners) {
                listener.apply(this, args);
            }
        }
        super.emit.apply(this, args);
        if (this._pid && args.length && typeof args[args.length - 1] === "string") {
            this._lastOffset = args[args.length - 1];
        }
    }
    /**
     * Produces an ack callback to emit with an event.
     *
     * @private
     */
    ack(id) {
        const self = this;
        let sent = false;
        return function (...args) {
            // prevent double callbacks
            if (sent)
                return;
            sent = true;
            self.packet({
                type: PacketType.ACK,
                id: id,
                data: args,
            });
        };
    }
    /**
     * Called upon a server acknowledgement.
     *
     * @param packet
     * @private
     */
    onack(packet) {
        const ack = this.acks[packet.id];
        if (typeof ack !== "function") {
            return;
        }
        delete this.acks[packet.id];
        // @ts-ignore FIXME ack is incorrectly inferred as 'never'
        if (ack.withError) {
            packet.data.unshift(null);
        }
        // @ts-ignore
        ack.apply(this, packet.data);
    }
    /**
     * Called upon server connect.
     *
     * @private
     */
    onconnect(id, pid) {
        this.id = id;
        this.recovered = pid && this._pid === pid;
        this._pid = pid; // defined only if connection state recovery is enabled
        this.connected = true;
        this.emitBuffered();
        this.emitReserved("connect");
        this._drainQueue(true);
    }
    /**
     * Emit buffered events (received and emitted).
     *
     * @private
     */
    emitBuffered() {
        this.receiveBuffer.forEach((args) => this.emitEvent(args));
        this.receiveBuffer = [];
        this.sendBuffer.forEach((packet) => {
            this.notifyOutgoingListeners(packet);
            this.packet(packet);
        });
        this.sendBuffer = [];
    }
    /**
     * Called upon server disconnect.
     *
     * @private
     */
    ondisconnect() {
        this.destroy();
        this.onclose("io server disconnect");
    }
    /**
     * Called upon forced client/server side disconnections,
     * this method ensures the manager stops tracking us and
     * that reconnections don't get triggered for this.
     *
     * @private
     */
    destroy() {
        if (this.subs) {
            // clean subscriptions to avoid reconnections
            this.subs.forEach((subDestroy) => subDestroy());
            this.subs = undefined;
        }
        this.io["_destroy"](this);
    }
    /**
     * Disconnects the socket manually. In that case, the socket will not try to reconnect.
     *
     * If this is the last active Socket instance of the {@link Manager}, the low-level connection will be closed.
     *
     * @example
     * const socket = io();
     *
     * socket.on("disconnect", (reason) => {
     *   // console.log(reason); prints "io client disconnect"
     * });
     *
     * socket.disconnect();
     *
     * @return self
     */
    disconnect() {
        if (this.connected) {
            this.packet({ type: PacketType.DISCONNECT });
        }
        // remove socket from pool
        this.destroy();
        if (this.connected) {
            // fire events
            this.onclose("io client disconnect");
        }
        return this;
    }
    /**
     * Alias for {@link disconnect()}.
     *
     * @return self
     */
    close() {
        return this.disconnect();
    }
    /**
     * Sets the compress flag.
     *
     * @example
     * socket.compress(false).emit("hello");
     *
     * @param compress - if `true`, compresses the sending data
     * @return self
     */
    compress(compress) {
        this.flags.compress = compress;
        return this;
    }
    /**
     * Sets a modifier for a subsequent event emission that the event message will be dropped when this socket is not
     * ready to send messages.
     *
     * @example
     * socket.volatile.emit("hello"); // the server may or may not receive it
     *
     * @returns self
     */
    get volatile() {
        this.flags.volatile = true;
        return this;
    }
    /**
     * Sets a modifier for a subsequent event emission that the callback will be called with an error when the
     * given number of milliseconds have elapsed without an acknowledgement from the server:
     *
     * @example
     * socket.timeout(5000).emit("my-event", (err) => {
     *   if (err) {
     *     // the server did not acknowledge the event in the given delay
     *   }
     * });
     *
     * @returns self
     */
    timeout(timeout) {
        this.flags.timeout = timeout;
        return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback.
     *
     * @example
     * socket.onAny((event, ...args) => {
     *   console.log(`got ${event}`);
     * });
     *
     * @param listener
     */
    onAny(listener) {
        this._anyListeners = this._anyListeners || [];
        this._anyListeners.push(listener);
        return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback. The listener is added to the beginning of the listeners array.
     *
     * @example
     * socket.prependAny((event, ...args) => {
     *   console.log(`got event ${event}`);
     * });
     *
     * @param listener
     */
    prependAny(listener) {
        this._anyListeners = this._anyListeners || [];
        this._anyListeners.unshift(listener);
        return this;
    }
    /**
     * Removes the listener that will be fired when any event is emitted.
     *
     * @example
     * const catchAllListener = (event, ...args) => {
     *   console.log(`got event ${event}`);
     * }
     *
     * socket.onAny(catchAllListener);
     *
     * // remove a specific listener
     * socket.offAny(catchAllListener);
     *
     * // or remove all listeners
     * socket.offAny();
     *
     * @param listener
     */
    offAny(listener) {
        if (!this._anyListeners) {
            return this;
        }
        if (listener) {
            const listeners = this._anyListeners;
            for (let i = 0; i < listeners.length; i++) {
                if (listener === listeners[i]) {
                    listeners.splice(i, 1);
                    return this;
                }
            }
        }
        else {
            this._anyListeners = [];
        }
        return this;
    }
    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
     * e.g. to remove listeners.
     */
    listenersAny() {
        return this._anyListeners || [];
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback.
     *
     * Note: acknowledgements sent to the server are not included.
     *
     * @example
     * socket.onAnyOutgoing((event, ...args) => {
     *   console.log(`sent event ${event}`);
     * });
     *
     * @param listener
     */
    onAnyOutgoing(listener) {
        this._anyOutgoingListeners = this._anyOutgoingListeners || [];
        this._anyOutgoingListeners.push(listener);
        return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback. The listener is added to the beginning of the listeners array.
     *
     * Note: acknowledgements sent to the server are not included.
     *
     * @example
     * socket.prependAnyOutgoing((event, ...args) => {
     *   console.log(`sent event ${event}`);
     * });
     *
     * @param listener
     */
    prependAnyOutgoing(listener) {
        this._anyOutgoingListeners = this._anyOutgoingListeners || [];
        this._anyOutgoingListeners.unshift(listener);
        return this;
    }
    /**
     * Removes the listener that will be fired when any event is emitted.
     *
     * @example
     * const catchAllListener = (event, ...args) => {
     *   console.log(`sent event ${event}`);
     * }
     *
     * socket.onAnyOutgoing(catchAllListener);
     *
     * // remove a specific listener
     * socket.offAnyOutgoing(catchAllListener);
     *
     * // or remove all listeners
     * socket.offAnyOutgoing();
     *
     * @param [listener] - the catch-all listener (optional)
     */
    offAnyOutgoing(listener) {
        if (!this._anyOutgoingListeners) {
            return this;
        }
        if (listener) {
            const listeners = this._anyOutgoingListeners;
            for (let i = 0; i < listeners.length; i++) {
                if (listener === listeners[i]) {
                    listeners.splice(i, 1);
                    return this;
                }
            }
        }
        else {
            this._anyOutgoingListeners = [];
        }
        return this;
    }
    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
     * e.g. to remove listeners.
     */
    listenersAnyOutgoing() {
        return this._anyOutgoingListeners || [];
    }
    /**
     * Notify the listeners for each packet sent
     *
     * @param packet
     *
     * @private
     */
    notifyOutgoingListeners(packet) {
        if (this._anyOutgoingListeners && this._anyOutgoingListeners.length) {
            const listeners = this._anyOutgoingListeners.slice();
            for (const listener of listeners) {
                listener.apply(this, packet.data);
            }
        }
    }
}

;// ./node_modules/socket.io-client/build/esm/contrib/backo2.js
/**
 * Initialize backoff timer with `opts`.
 *
 * - `min` initial timeout in milliseconds [100]
 * - `max` max timeout [10000]
 * - `jitter` [0]
 * - `factor` [2]
 *
 * @param {Object} opts
 * @api public
 */
function Backoff(opts) {
    opts = opts || {};
    this.ms = opts.min || 100;
    this.max = opts.max || 10000;
    this.factor = opts.factor || 2;
    this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
    this.attempts = 0;
}
/**
 * Return the backoff duration.
 *
 * @return {Number}
 * @api public
 */
Backoff.prototype.duration = function () {
    var ms = this.ms * Math.pow(this.factor, this.attempts++);
    if (this.jitter) {
        var rand = Math.random();
        var deviation = Math.floor(rand * this.jitter * ms);
        ms = (Math.floor(rand * 10) & 1) == 0 ? ms - deviation : ms + deviation;
    }
    return Math.min(ms, this.max) | 0;
};
/**
 * Reset the number of attempts.
 *
 * @api public
 */
Backoff.prototype.reset = function () {
    this.attempts = 0;
};
/**
 * Set the minimum duration
 *
 * @api public
 */
Backoff.prototype.setMin = function (min) {
    this.ms = min;
};
/**
 * Set the maximum duration
 *
 * @api public
 */
Backoff.prototype.setMax = function (max) {
    this.max = max;
};
/**
 * Set the jitter
 *
 * @api public
 */
Backoff.prototype.setJitter = function (jitter) {
    this.jitter = jitter;
};

;// ./node_modules/socket.io-client/build/esm/manager.js






class Manager extends Emitter {
    constructor(uri, opts) {
        var _a;
        super();
        this.nsps = {};
        this.subs = [];
        if (uri && "object" === typeof uri) {
            opts = uri;
            uri = undefined;
        }
        opts = opts || {};
        opts.path = opts.path || "/socket.io";
        this.opts = opts;
        installTimerFunctions(this, opts);
        this.reconnection(opts.reconnection !== false);
        this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
        this.reconnectionDelay(opts.reconnectionDelay || 1000);
        this.reconnectionDelayMax(opts.reconnectionDelayMax || 5000);
        this.randomizationFactor((_a = opts.randomizationFactor) !== null && _a !== void 0 ? _a : 0.5);
        this.backoff = new Backoff({
            min: this.reconnectionDelay(),
            max: this.reconnectionDelayMax(),
            jitter: this.randomizationFactor(),
        });
        this.timeout(null == opts.timeout ? 20000 : opts.timeout);
        this._readyState = "closed";
        this.uri = uri;
        const _parser = opts.parser || socket_io_parser_build_esm_namespaceObject;
        this.encoder = new _parser.Encoder();
        this.decoder = new _parser.Decoder();
        this._autoConnect = opts.autoConnect !== false;
        if (this._autoConnect)
            this.open();
    }
    reconnection(v) {
        if (!arguments.length)
            return this._reconnection;
        this._reconnection = !!v;
        if (!v) {
            this.skipReconnect = true;
        }
        return this;
    }
    reconnectionAttempts(v) {
        if (v === undefined)
            return this._reconnectionAttempts;
        this._reconnectionAttempts = v;
        return this;
    }
    reconnectionDelay(v) {
        var _a;
        if (v === undefined)
            return this._reconnectionDelay;
        this._reconnectionDelay = v;
        (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMin(v);
        return this;
    }
    randomizationFactor(v) {
        var _a;
        if (v === undefined)
            return this._randomizationFactor;
        this._randomizationFactor = v;
        (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setJitter(v);
        return this;
    }
    reconnectionDelayMax(v) {
        var _a;
        if (v === undefined)
            return this._reconnectionDelayMax;
        this._reconnectionDelayMax = v;
        (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMax(v);
        return this;
    }
    timeout(v) {
        if (!arguments.length)
            return this._timeout;
        this._timeout = v;
        return this;
    }
    /**
     * Starts trying to reconnect if reconnection is enabled and we have not
     * started reconnecting yet
     *
     * @private
     */
    maybeReconnectOnOpen() {
        // Only try to reconnect if it's the first time we're connecting
        if (!this._reconnecting &&
            this._reconnection &&
            this.backoff.attempts === 0) {
            // keeps reconnection from firing twice for the same reconnection loop
            this.reconnect();
        }
    }
    /**
     * Sets the current transport `socket`.
     *
     * @param {Function} fn - optional, callback
     * @return self
     * @public
     */
    open(fn) {
        if (~this._readyState.indexOf("open"))
            return this;
        this.engine = new Socket(this.uri, this.opts);
        const socket = this.engine;
        const self = this;
        this._readyState = "opening";
        this.skipReconnect = false;
        // emit `open`
        const openSubDestroy = on(socket, "open", function () {
            self.onopen();
            fn && fn();
        });
        const onError = (err) => {
            this.cleanup();
            this._readyState = "closed";
            this.emitReserved("error", err);
            if (fn) {
                fn(err);
            }
            else {
                // Only do this if there is no fn to handle the error
                this.maybeReconnectOnOpen();
            }
        };
        // emit `error`
        const errorSub = on(socket, "error", onError);
        if (false !== this._timeout) {
            const timeout = this._timeout;
            // set timer
            const timer = this.setTimeoutFn(() => {
                openSubDestroy();
                onError(new Error("timeout"));
                socket.close();
            }, timeout);
            if (this.opts.autoUnref) {
                timer.unref();
            }
            this.subs.push(() => {
                this.clearTimeoutFn(timer);
            });
        }
        this.subs.push(openSubDestroy);
        this.subs.push(errorSub);
        return this;
    }
    /**
     * Alias for open()
     *
     * @return self
     * @public
     */
    connect(fn) {
        return this.open(fn);
    }
    /**
     * Called upon transport open.
     *
     * @private
     */
    onopen() {
        // clear old subs
        this.cleanup();
        // mark as open
        this._readyState = "open";
        this.emitReserved("open");
        // add new subs
        const socket = this.engine;
        this.subs.push(on(socket, "ping", this.onping.bind(this)), on(socket, "data", this.ondata.bind(this)), on(socket, "error", this.onerror.bind(this)), on(socket, "close", this.onclose.bind(this)), 
        // @ts-ignore
        on(this.decoder, "decoded", this.ondecoded.bind(this)));
    }
    /**
     * Called upon a ping.
     *
     * @private
     */
    onping() {
        this.emitReserved("ping");
    }
    /**
     * Called with data.
     *
     * @private
     */
    ondata(data) {
        try {
            this.decoder.add(data);
        }
        catch (e) {
            this.onclose("parse error", e);
        }
    }
    /**
     * Called when parser fully decodes a packet.
     *
     * @private
     */
    ondecoded(packet) {
        // the nextTick call prevents an exception in a user-provided event listener from triggering a disconnection due to a "parse error"
        nextTick(() => {
            this.emitReserved("packet", packet);
        }, this.setTimeoutFn);
    }
    /**
     * Called upon socket error.
     *
     * @private
     */
    onerror(err) {
        this.emitReserved("error", err);
    }
    /**
     * Creates a new socket for the given `nsp`.
     *
     * @return {Socket}
     * @public
     */
    socket(nsp, opts) {
        let socket = this.nsps[nsp];
        if (!socket) {
            socket = new socket_Socket(this, nsp, opts);
            this.nsps[nsp] = socket;
        }
        else if (this._autoConnect && !socket.active) {
            socket.connect();
        }
        return socket;
    }
    /**
     * Called upon a socket close.
     *
     * @param socket
     * @private
     */
    _destroy(socket) {
        const nsps = Object.keys(this.nsps);
        for (const nsp of nsps) {
            const socket = this.nsps[nsp];
            if (socket.active) {
                return;
            }
        }
        this._close();
    }
    /**
     * Writes a packet.
     *
     * @param packet
     * @private
     */
    _packet(packet) {
        const encodedPackets = this.encoder.encode(packet);
        for (let i = 0; i < encodedPackets.length; i++) {
            this.engine.write(encodedPackets[i], packet.options);
        }
    }
    /**
     * Clean up transport subscriptions and packet buffer.
     *
     * @private
     */
    cleanup() {
        this.subs.forEach((subDestroy) => subDestroy());
        this.subs.length = 0;
        this.decoder.destroy();
    }
    /**
     * Close the current socket.
     *
     * @private
     */
    _close() {
        this.skipReconnect = true;
        this._reconnecting = false;
        this.onclose("forced close");
    }
    /**
     * Alias for close()
     *
     * @private
     */
    disconnect() {
        return this._close();
    }
    /**
     * Called when:
     *
     * - the low-level engine is closed
     * - the parser encountered a badly formatted packet
     * - all sockets are disconnected
     *
     * @private
     */
    onclose(reason, description) {
        var _a;
        this.cleanup();
        (_a = this.engine) === null || _a === void 0 ? void 0 : _a.close();
        this.backoff.reset();
        this._readyState = "closed";
        this.emitReserved("close", reason, description);
        if (this._reconnection && !this.skipReconnect) {
            this.reconnect();
        }
    }
    /**
     * Attempt a reconnection.
     *
     * @private
     */
    reconnect() {
        if (this._reconnecting || this.skipReconnect)
            return this;
        const self = this;
        if (this.backoff.attempts >= this._reconnectionAttempts) {
            this.backoff.reset();
            this.emitReserved("reconnect_failed");
            this._reconnecting = false;
        }
        else {
            const delay = this.backoff.duration();
            this._reconnecting = true;
            const timer = this.setTimeoutFn(() => {
                if (self.skipReconnect)
                    return;
                this.emitReserved("reconnect_attempt", self.backoff.attempts);
                // check again for the case socket closed in above events
                if (self.skipReconnect)
                    return;
                self.open((err) => {
                    if (err) {
                        self._reconnecting = false;
                        self.reconnect();
                        this.emitReserved("reconnect_error", err);
                    }
                    else {
                        self.onreconnect();
                    }
                });
            }, delay);
            if (this.opts.autoUnref) {
                timer.unref();
            }
            this.subs.push(() => {
                this.clearTimeoutFn(timer);
            });
        }
    }
    /**
     * Called upon successful reconnect.
     *
     * @private
     */
    onreconnect() {
        const attempt = this.backoff.attempts;
        this._reconnecting = false;
        this.backoff.reset();
        this.emitReserved("reconnect", attempt);
    }
}

;// ./node_modules/socket.io-client/build/esm/index.js



/**
 * Managers cache.
 */
const cache = {};
function esm_lookup(uri, opts) {
    if (typeof uri === "object") {
        opts = uri;
        uri = undefined;
    }
    opts = opts || {};
    const parsed = url(uri, opts.path || "/socket.io");
    const source = parsed.source;
    const id = parsed.id;
    const path = parsed.path;
    const sameNamespace = cache[id] && path in cache[id]["nsps"];
    const newConnection = opts.forceNew ||
        opts["force new connection"] ||
        false === opts.multiplex ||
        sameNamespace;
    let io;
    if (newConnection) {
        io = new Manager(source, opts);
    }
    else {
        if (!cache[id]) {
            cache[id] = new Manager(source, opts);
        }
        io = cache[id];
    }
    if (parsed.query && !opts.query) {
        opts.query = parsed.queryKey;
    }
    return io.socket(parsed.path, opts);
}
// so that "lookup" can be used both as a function (e.g. `io(...)`) and as a
// namespace (e.g. `io.connect(...)`), for backward compatibility
Object.assign(esm_lookup, {
    Manager: Manager,
    Socket: socket_Socket,
    io: esm_lookup,
    connect: esm_lookup,
});
/**
 * Protocol version.
 *
 * @public
 */

/**
 * Expose constructors for standalone build.
 *
 * @public
 */



;// ./src/socket.ts


function initMultiPlayerMode(game, serverIp) {
    // Use current origin as default, or prompt if needed
    const defaultUrl = serverIp || window.location.origin;
    const serverUrl = prompt(`Enter the server URL (default: ${defaultUrl}):\n\nJoin a public server: https://54.151.123.177:3000/`) || defaultUrl;
    game.socket = esm_lookup(serverUrl, {
        secure: true,
        rejectUnauthorized: false,
        withCredentials: true
    });
    game.socket.on('connect', () => {
        const connectTime = performance.now();
        console.log(`[CLIENT] Connected to server at ${connectTime.toFixed(0)}`);
        game.hideTitleScreen();
        game.showExitButton();
    });
    setupSocketListeners(game);
}
function setupSocketListeners(game) {
    game.socket.on('connect', () => {
        const connectTime = performance.now();
        console.log(`[CLIENT] Socket connected with ID ${game.socket.id} at ${connectTime.toFixed(0)}`);
        // Handle cross-server transfer claim if pending
        if (game.pendingTransfer) {
            console.log(`[CLIENT] Connected to new server, claiming transferred player`);
            fetch(game.pendingTransfer.newServerUrl + '/transfer/claim', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    transferToken: game.pendingTransfer.transferToken,
                    newSocketId: game.socket.id
                })
            })
                .then(response => response.json())
                .then(data => {
                if (data.success) {
                    console.log('[CLIENT] Successfully claimed transferred player');
                    game.hideTransferMessage();
                    // Ensure player data is properly initialized with defaults if needed
                    if (data.playerData && game.socket.id) {
                        // Clean up any existing player with the same ID to prevent duplicates
                        game.players.delete(game.socket.id);
                        // Ensure loadout is properly initialized
                        if (!data.playerData.loadout || !Array.isArray(data.playerData.loadout)) {
                            data.playerData.loadout = [];
                            console.warn('[CLIENT] Transferred player had invalid loadout, initialized empty array');
                        }
                        // Ensure inventory is properly initialized
                        if (!data.playerData.inventory || typeof data.playerData.inventory !== 'object') {
                            data.playerData.inventory = {};
                            console.warn('[CLIENT] Transferred player had invalid inventory, initialized empty object');
                        }
                        // Create new player object with transferred data
                        const currentPlayer = {
                            id: game.socket.id,
                            name: data.playerData.name || 'Anonymous',
                            x: data.playerData.x || 200,
                            y: data.playerData.y || 200,
                            angle: data.playerData.angle || 0,
                            score: data.playerData.score || 0,
                            imageLoaded: false,
                            image: new Image(),
                            velocityX: 0,
                            velocityY: 0,
                            health: data.playerData.health || 100,
                            maxHealth: data.playerData.maxHealth || 100,
                            damage: data.playerData.damage || 10,
                            inventory: data.playerData.inventory || {},
                            loadout: data.playerData.loadout || [],
                            level: data.playerData.level || 1,
                            xp: data.playerData.xp || 0,
                            xpToNextLevel: data.playerData.xpToNextLevel || 100,
                            targetX: data.playerData.x || 200,
                            targetY: data.playerData.y || 200
                        };
                        // Set the new player data
                        game.players.set(game.socket.id, currentPlayer);
                        console.log('[CLIENT] Player data updated after transfer');
                    }
                    // Update chat system to use new socket
                    if (game.chat) {
                        game.chat.updateSocket(game.socket);
                    }
                    // Clear pending transfer
                    delete game.pendingTransfer;
                }
                else {
                    console.error('[CLIENT] Failed to claim transferred player:', data.message);
                    game.showTransferMessage('Transfer failed. Please try again.');
                }
            })
                .catch(error => {
                console.error('[CLIENT] Error claiming transferred player:', error);
                game.showTransferMessage('Transfer failed. Please try again.');
            });
        }
        else {
            // Normal connection (not a transfer)
            if (game.socket.id) {
                game.socket.emit('chatMessage', `${game.players.get(game.socket.id)?.name} has joined the game`);
            }
            // Update chat system to use new socket (for reconnections)
            if (game.chat) {
                game.chat.updateSocket(game.socket);
            }
        }
        // Start heartbeat monitoring (clear any existing interval first)
        if (game.heartbeatInterval) {
            clearInterval(game.heartbeatInterval);
        }
        game.lastHeartbeat = performance.now();
        game.heartbeatInterval = setInterval(() => {
            const now = performance.now();
            const timeSinceLastHeartbeat = now - game.lastHeartbeat;
            if (timeSinceLastHeartbeat > 5000) { // 5 seconds without heartbeat
                console.log(`[CLIENT] Warning: No server response for ${timeSinceLastHeartbeat.toFixed(0)}ms`);
            }
            game.socket.emit('ping', now);
        }, 1000); // Send ping every second
    });
    // Handle cross-server transfer
    game.socket.on('playerTransferred', async (transferData) => {
        console.log(`[CLIENT] Player being transferred to server ${transferData.targetServer.name} on port ${transferData.targetServer.port}`);
        try {
            // Hide teleporter UI since we're transferring
            game.hideTeleporterUI();
            // Disconnect from current server
            game.socket.disconnect();
            // Clear heartbeat interval
            if (game.heartbeatInterval) {
                clearInterval(game.heartbeatInterval);
            }
            // Show transfer message to player
            game.showTransferMessage(`Transferring to ${transferData.targetServer.name}...`);
            // Wait a moment for disconnect to complete
            await new Promise(resolve => setTimeout(resolve, 500));
            // Connect to new server
            const newServerUrl = `https://${transferData.targetServer.host}:${transferData.targetServer.port}`;
            game.socket = esm_lookup(newServerUrl, {
                secure: true,
                rejectUnauthorized: false,
                withCredentials: true
            });
            // Store transfer data for claiming after reconnect
            game.pendingTransfer = {
                transferToken: transferData.transferToken,
                targetX: transferData.targetX,
                targetY: transferData.targetY,
                newServerUrl: newServerUrl
            };
            // Set up listeners for new connection (this will handle the connect event)
            setupSocketListeners(game);
        }
        catch (error) {
            console.error('[CLIENT] Error during server transfer:', error);
            game.showTransferMessage('Transfer failed. Please try again.');
        }
    });
    // Handle transfer failure
    game.socket.on('transferFailed', (data) => {
        console.error('[CLIENT] Server transfer failed:', data.message);
        game.showTransferMessage('Transfer failed: ' + data.message);
    });
    // Handle same-server teleportation
    game.socket.on('playerTeleported', (data) => {
        console.log(`[CLIENT] Player ${data.playerId} teleported to (${data.newX}, ${data.newY})`);
        // Update player position if it's the current player
        const player = game.players.get(data.playerId);
        if (player) {
            player.x = data.newX;
            player.y = data.newY;
            // Add teleport effect
            game.addTeleportEffect(data.newX, data.newY);
        }
        // Hide teleporter UI if it's the current player
        if (data.playerId === game.socket.id) {
            game.hideTeleporterUI();
        }
    });
    // Handle teleporter entry (player entered teleporter)
    game.socket.on('teleporterEntered', (data) => {
        console.log(`[CLIENT] Entered teleporter, waiting ${data.timeRequired}ms to teleport`);
        // Show teleporter countdown UI
        game.showTeleporterUI(data.teleportTo, data.timeRequired);
    });
    // Handle teleporter exit (player left teleporter before teleporting)
    game.socket.on('teleporterExited', () => {
        console.log('[CLIENT] Left teleporter before teleporting');
        // Hide teleporter UI
        game.hideTeleporterUI();
    });
    // Add runJS event handler
    game.socket.on('runJS', (code) => {
        try {
            // Create a new Function to execute the code in a safer context
            const safeEval = new Function(code);
            safeEval();
        }
        catch (error) {
            console.error('Error executing JS:', error);
        }
    });
    // Add serverType event handler
    game.socket.on('serverType', (type) => {
        console.log(`Connected to ${type} server`);
        // You can add visual feedback here if needed
        game.showFloatingText(game.canvas.width / 2, 50, `Connected to ${type} server`, '#00FF00', 24);
    });
    game.socket.on('currentPlayers', (players) => {
        //console.log('Received current players:', players);
        game.players.clear();
        Object.values(players).forEach(player => {
            // Don't override health with max health
            game.players.set(player.id, {
                ...player,
                imageLoaded: true,
                score: 0,
                velocityX: 0,
                velocityY: 0
            });
        });
    });
    game.socket.on('newPlayer', (player) => {
        //console.log('New player joined:', player);
        game.players.set(player.id, {
            ...player,
            imageLoaded: true,
            score: 0,
            velocityX: 0,
            velocityY: 0
        });
        if (player.id === game.socket.id && game.inventoryManager) {
            game.inventoryManager.updateLoadoutDisplay();
        }
    });
    game.socket.on('playerMoved', (player) => {
        const now = performance.now();
        game.lastHeartbeat = now; // Update heartbeat on any server message
        const existingPlayer = game.players.get(player.id);
        const isCurrentPlayer = player.id === game.socket?.id;
        // Debug: Log server position updates with timing
        if (existingPlayer && isCurrentPlayer) {
            const positionDiff = Math.sqrt(Math.pow(existingPlayer.x - player.x, 2) +
                Math.pow(existingPlayer.y - player.y, 2));
            console.log(`[CLIENT] playerMoved received at ${now.toFixed(0)}: server(${player.x.toFixed(1)}, ${player.y.toFixed(1)}) client_current(${existingPlayer.x.toFixed(1)}, ${existingPlayer.y.toFixed(1)}) diff:${positionDiff.toFixed(1)}px`);
        }
        console.log(`[CLIENT] Received playerMoved for ${player.id}:`, {
            x: player.x.toFixed(1),
            y: player.y.toFixed(1),
            isMe: player.id === game.socket?.id
        });
        if (existingPlayer) {
            if (isCurrentPlayer) {
                // For current player, use smooth interpolation to server position
                console.log(`[CLIENT] Updating position from server: (${existingPlayer.x.toFixed(1)}, ${existingPlayer.y.toFixed(1)}) -> (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`);
                existingPlayer.targetX = player.x;
                existingPlayer.targetY = player.y;
            }
            else {
                // For other players, use interpolation to smooth movement
                existingPlayer.targetX = player.x;
                existingPlayer.targetY = player.y;
            }
            // Update other properties
            existingPlayer.angle = player.angle;
            existingPlayer.velocityX = player.velocityX;
            existingPlayer.velocityY = player.velocityY;
            existingPlayer.health = player.health;
            existingPlayer.maxHealth = player.maxHealth;
            existingPlayer.level = player.level;
            existingPlayer.score = player.score;
        }
        else {
            game.players.set(player.id, {
                ...player,
                imageLoaded: true,
                score: 0,
                velocityX: 0,
                velocityY: 0,
                targetX: player.x,
                targetY: player.y
            });
        }
    });
    game.socket.on('disconnect', (reason) => {
        const disconnectTime = performance.now();
        console.log(`[CLIENT] Disconnected from server at ${disconnectTime.toFixed(0)}, reason: ${reason}`);
        // Clear heartbeat monitoring
        if (game.heartbeatInterval) {
            clearInterval(game.heartbeatInterval);
            game.heartbeatInterval = null;
        }
        // Hide teleporter UI on disconnect to prevent UI from staying visible
        game.hideTeleporterUI();
    });
    game.socket.on('pong', (serverTime) => {
        const now = performance.now();
        const roundTripTime = now - serverTime;
        game.lastHeartbeat = now;
        if (roundTripTime < 1000) { // Only log normal pings, not catch-up ones
            console.log(`[CLIENT] Ping: ${roundTripTime.toFixed(1)}ms`);
        }
        else {
            console.log(`[CLIENT] High ping detected: ${roundTripTime.toFixed(1)}ms`);
        }
    });
    game.socket.on('connect_error', (error) => {
        const errorTime = performance.now();
        console.log(`[CLIENT] Connection error at ${errorTime.toFixed(0)}:`, error);
    });
    game.socket.on('playerDisconnected', (playerId) => {
        const disconnectTime = performance.now();
        console.log(`[CLIENT] Player ${playerId} disconnected at ${disconnectTime.toFixed(0)}`);
        game.players.delete(playerId);
    });
    // Handle player leaving (for cross-server transfers)
    game.socket.on('playerLeft', (playerId) => {
        console.log(`[CLIENT] Player ${playerId} left the server`);
        game.players.delete(playerId);
    });
    game.socket.on('dotCollected', (data) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.score++;
        }
        game.dots.splice(data.dotIndex, 1);
        game.generateDot();
    });
    game.socket.on('enemiesUpdate', (enemies) => {
        game.enemies.clear();
        enemies.forEach(enemy => game.enemies.set(enemy.id, enemy));
    });
    game.socket.on('enemyMoved', (enemy) => {
        game.enemies.set(enemy.id, enemy);
    });
    game.socket.on('playerDamaged', (data) => {
        console.log('Player damaged event received:', data);
        const player = game.players.get(data.playerId);
        if (player) {
            const oldHealth = player.health;
            player.health = data.health;
            player.maxHealth = data.maxHealth || player.maxHealth;
            // Update invulnerability status
            if (data.isInvulnerable !== undefined) {
                player.isInvulnerable = data.isInvulnerable;
                // Set a client-side backup timer in case server event is missed
                if (data.isInvulnerable) {
                    setTimeout(() => {
                        if (player && player.isInvulnerable) {
                            player.isInvulnerable = false;
                            console.log(`[CLIENT] Backup timer: Player ${data.playerId} invulnerability ended`);
                        }
                    }, 2000); // 2 seconds backup (longer than server 1 second)
                }
            }
            // Apply knockback if provided
            if (data.knockbackX !== undefined && data.knockbackY !== undefined) {
                player.knockbackX = data.knockbackX;
                player.knockbackY = data.knockbackY;
            }
            // Add visual feedback for damage taken
            const damageTaken = oldHealth - data.health;
            if (damageTaken > 0) {
                game.showFloatingText(player.x, player.y - 20, `-${damageTaken}`, '#FF0000', 20);
            }
        }
    });
    game.socket.on('enemyDamaged', (data) => {
        const enemy = game.enemies.get(data.enemyId);
        if (enemy) {
            enemy.health = data.health;
        }
    });
    game.socket.on('enemyDestroyed', (enemyId) => {
        game.enemies.delete(enemyId);
    });
    game.socket.on('playerInvulnerabilityEnded', (data) => {
        const player = game.players.get(data.playerId);
        if (player) {
            player.isInvulnerable = false;
            console.log(`[CLIENT] Player ${data.playerId} invulnerability ended`);
        }
    });
    game.socket.on('obstaclesUpdate', (obstacles) => {
        game.obstacles = obstacles;
    });
    game.socket.on('obstacleDamaged', (data) => {
        const obstacle = game.obstacles.find((o) => o.id === data.obstacleId);
        if (obstacle && obstacle.isEnemy) {
            obstacle.health = data.health;
        }
    });
    game.socket.on('obstacleDestroyed', (obstacleId) => {
        const index = game.obstacles.findIndex((o) => o.id === obstacleId);
        if (index !== -1) {
            game.obstacles.splice(index, 1);
        }
    });
    game.socket.on('itemsUpdate', (items) => {
        game.items.clear();
        items.forEach(item => {
            game.items.set(item.id, item);
        });
    });
    game.socket.on('itemSpawned', (item) => {
        console.log('Item spawned:', item);
        game.items.set(item.id, item);
    });
    game.socket.on('itemPickedUp', (itemId) => {
        console.log('Item picked up:', itemId);
        game.items.delete(itemId);
    });
    game.socket.on('petalBroken', (data) => {
        console.log('Petal broken:', data);
        const player = game.players.get(data.playerId);
        if (player && player.loadout) {
            // Set petal on cooldown instead of removing it
            if (player.loadout[data.slotIndex]) {
                player.loadout[data.slotIndex].onCooldown = true;
            }
            // Update inventory display if it's the current player
            if (data.playerId === game.socket.id) {
                if (game.isInventoryOpen) {
                    game.updateInventoryDisplay();
                }
                if (game.inventoryManager) {
                    game.inventoryManager.updateLoadoutDisplay();
                }
            }
        }
    });
    game.socket.on('petalRestored', (data) => {
        console.log('Petal restored:', data);
        const player = game.players.get(data.playerId);
        if (player && player.loadout) {
            // Restore the petal to the loadout
            player.loadout[data.slotIndex] = data.petal;
            // Update inventory display if it's the current player
            if (data.playerId === game.socket.id) {
                if (game.isInventoryOpen) {
                    game.updateInventoryDisplay();
                }
                if (game.inventoryManager) {
                    game.inventoryManager.updateLoadoutDisplay();
                }
            }
        }
    });
    game.socket.on('itemCollected', (data) => {
        const player = game.players.get(data.playerId);
        if (player) {
            game.items.delete(data.itemId);
            if (data.playerId === game.socket.id) {
                // Update inventory display if it's open
                if (game.isInventoryOpen) {
                    game.updateInventoryDisplay();
                }
            }
        }
    });
    game.socket.on('inventoryUpdate', (inventory) => {
        const player = game.players.get(game.socket?.id || '');
        if (player) {
            player.inventory = inventory;
            // Update inventory display if it's open
            if (game.isInventoryOpen) {
                game.updateInventoryDisplay();
            }
        }
    });
    game.socket.on('xpGained', (data) => {
        console.log('XP gained:', data); // Add logging
        const player = game.players.get(data.playerId);
        if (player) {
            player.xp = data.totalXp;
            player.level = data.level;
            player.xpToNextLevel = data.xpToNextLevel;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            game.showFloatingText(player.x, player.y - 20, '+' + data.xp + ' XP', '#32CD32', 16);
            game.savePlayerProgress(player);
        }
    });
    game.socket.on('levelUp', (data) => {
        //console.log('Level up:', data);  // Add logging
        const player = game.players.get(data.playerId);
        if (player) {
            player.level = data.level;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            game.showFloatingText(player.x, player.y - 30, 'Level Up! Level ' + data.level, '#FFD700', 24);
            game.savePlayerProgress(player);
        }
    });
    game.socket.on('playerLostLevel', (data) => {
        //console.log('Player lost level:', data);
        const player = game.players.get(data.playerId);
        if (player) {
            player.level = data.level;
            player.maxHealth = data.maxHealth;
            player.damage = data.damage;
            player.xp = data.xp;
            player.xpToNextLevel = data.xpToNextLevel;
            // Show level loss message
            game.showFloatingText(player.x, player.y - 30, 'Level Lost! Level ' + data.level, '#FF0000', 24);
            // Save the new progress
            game.savePlayerProgress(player);
        }
    });
    game.socket.on('playerRespawned', (player) => {
        const existingPlayer = game.players.get(player.id);
        if (existingPlayer) {
            Object.assign(existingPlayer, player);
            if (player.id === game.socket.id) {
                game.isPlayerDead = false;
                game.hideDeathScreen();
            }
            // Show respawn message
            game.showFloatingText(player.x, player.y - 50, 'Respawned!', '#FFFFFF', 20);
        }
    });
    game.socket.on('playerDied', (playerId) => {
        if (playerId === game.socket.id) {
            game.isPlayerDead = true;
            game.showDeathScreen();
        }
    });
    game.socket.on('decorationsUpdate', (decorations) => {
        game.decorations = decorations;
    });
    game.socket.on('sandsUpdate', (sands) => {
        game.sands = sands;
    });
    game.socket.on('playerUpdated', (updatedPlayer) => {
        const player = game.players.get(updatedPlayer.id);
        if (player) {
            Object.assign(player, updatedPlayer);
            // Update displays if this is the current player
            if (updatedPlayer.id === game.socket?.id) {
                if (game.isInventoryOpen) {
                    game.updateInventoryDisplay();
                }
                if (game.inventoryManager) {
                    game.inventoryManager.updateLoadoutDisplay();
                }
            }
        }
    });
    game.socket.on('speedBoostActive', (playerId) => {
        console.log('Speed boost active:', playerId);
        if (playerId === game.socket.id) {
            game.speedBoostActive = true;
            console.log('Speed boost active for client');
        }
    });
    game.socket.on('savePlayerProgress', () => {
        game.showSaveIndicator();
    });
    game.socket.on('craftingFinished', (data) => {
        const player = game.players.get(game.socket?.id || '');
        if (player) {
            player.inventory = data.inventory;
            if (data.successCount > 0) {
                game.showFloatingText(game.canvas.width / 2, 50, `Successfully crafted ${data.successCount}x ${data.newItem.rarity} ${data.newItem.type}!`, game.ITEM_RARITY_COLORS[data.newItem.rarity || 'common'], 24);
            }
            if (data.failCount > 0) {
                game.showFloatingText(game.canvas.width / 2, 80, `Failed to craft ${data.failCount}x. Items were lost.`, '#FF0000', 20);
            }
            if (game.inventoryManager.isCraftingOpen) {
                game.inventoryManager.updateCraftingDisplay();
            }
        }
    });
    // Listen for server game state updates for better synchronization
    game.socket.on('gameStateUpdate', (data) => {
        const serverPlayers = data.players;
        const serverEnemies = data.enemies;
        serverPlayers.forEach(serverPlayer => {
            const existingPlayer = game.players.get(serverPlayer.id);
            if (existingPlayer) {
                existingPlayer.targetX = serverPlayer.x;
                existingPlayer.targetY = serverPlayer.y;
                existingPlayer.angle = serverPlayer.angle;
                existingPlayer.health = serverPlayer.health;
                existingPlayer.maxHealth = serverPlayer.maxHealth;
                existingPlayer.level = serverPlayer.level;
                // Preserve XP values - don't overwrite them from gameStateUpdate
                // as they are managed separately by xpGained events
            }
            else {
                game.players.set(serverPlayer.id, {
                    ...serverPlayer,
                    imageLoaded: true,
                    score: 0,
                    velocityX: 0,
                    velocityY: 0,
                    targetX: serverPlayer.x,
                    targetY: serverPlayer.y,
                    // Initialize XP values for new players
                    xp: 0,
                    xpToNextLevel: 100
                });
            }
        });
        if (serverEnemies) {
            game.enemies.clear();
            serverEnemies.forEach(enemy => {
                game.enemies.set(enemy.id, enemy);
            });
        }
    });
    game.socket.on('updatePlayers', (serverPlayers) => {
        const serverPlayerIds = serverPlayers.map(p => p.id);
        // Remove players that are no longer sent by the server
        game.players.forEach((player, playerId) => {
            if (!serverPlayerIds.includes(playerId)) {
                game.players.delete(playerId);
            }
        });
        serverPlayers.forEach(serverPlayer => {
            let player = game.players.get(serverPlayer.id);
            if (player) {
                // Update existing player
                player.x = serverPlayer.x;
                player.y = serverPlayer.y;
                player.angle = serverPlayer.angle;
                player.score = serverPlayer.score;
                player.health = serverPlayer.health;
                player.maxHealth = serverPlayer.maxHealth;
                player.damage = serverPlayer.damage;
                player.inventory = serverPlayer.inventory;
                player.loadout = serverPlayer.loadout;
                player.isInvulnerable = serverPlayer.isInvulnerable;
                player.knockbackX = serverPlayer.knockbackX;
                player.knockbackY = serverPlayer.knockbackY;
                player.level = serverPlayer.level;
                player.xp = serverPlayer.xp;
                player.xpToNextLevel = serverPlayer.xpToNextLevel;
                player.lastDamageTime = serverPlayer.lastDamageTime;
                player.speed_boost = serverPlayer.speed_boost;
            }
            else {
                // Add new player
                player = {
                    ...serverPlayer,
                    image: new Image(),
                    imageLoaded: false,
                    targetX: serverPlayer.x,
                    targetY: serverPlayer.y,
                };
                player.image.src = 'assets/player.png';
                player.image.onload = () => {
                    player.imageLoaded = true;
                };
                game.players.set(serverPlayer.id, player);
            }
        });
    });
    game.socket.on('updateEnemies', (serverEnemies) => {
        game.enemies.clear();
        serverEnemies.forEach(enemy => {
            game.enemies.set(enemy.id, enemy);
        });
    });
    game.socket.on('updateItems', (serverItems) => {
        game.items.clear();
        serverItems.forEach(item => {
            game.items.set(item.id, item);
        });
    });
    game.socket.on('playerDied', (data) => {
        if (data.playerId === game.socket.id) {
            game.isPlayerDead = true;
            game.showDeathScreen();
        }
    });
}

;// ./src/inventory.ts

class InventoryManager {
    constructor(game, chat) {
        this.inventoryPanel = null;
        this.craftingPanel = null;
        this.craftingItems = [];
        this.isInventoryOpen = false;
        this.isCraftingOpen = false;
        this.LOADOUT_SLOTS = 10;
        this.LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
        this.chat = null;
        this.ITEM_RARITY_COLORS = {
            common: '#7eef6d',
            uncommon: '#ffe65d',
            rare: '#4d52e3',
            epic: '#861fde',
            legendary: '#de1f1f',
            mythic: '#1fdbde',
            ultra: '#de1f65',
            super: '#2bffa4',
            unique: '#bf00ff'
        };
        this.game = game;
        this.chat = chat;
        this.allPetalTypes = (0,src_petals/* getAllPetalTypes */.tn)();
        // Create loadout bar
        const loadoutBar = document.createElement('div');
        loadoutBar.id = 'loadoutBar';
        loadoutBar.style.position = 'fixed';
        loadoutBar.style.bottom = '20px';
        loadoutBar.style.left = '50%';
        loadoutBar.style.transform = 'translateX(-50%)';
        loadoutBar.style.display = 'flex';
        loadoutBar.style.gap = '5px';
        loadoutBar.style.zIndex = '1000';
        for (let i = 0; i < this.LOADOUT_SLOTS; i++) {
            const slot = document.createElement('div');
            slot.className = 'loadout-slot';
            slot.dataset.slot = i.toString();
            slot.style.width = '50px';
            slot.style.height = '50px';
            slot.style.backgroundColor = 'rgba(99, 255, 182, 1)';
            slot.style.border = '2px solid #00ba3e';
            slot.style.borderRadius = '5px';
            loadoutBar.appendChild(slot);
        }
        document.body.appendChild(loadoutBar);
        loadoutBar.style.backgroundColor = 'red'; // Debug: make background visible
        loadoutBar.style.opacity = '1'; // Debug: ensure not transparent
        loadoutBar.style.zIndex = '9999'; // Debug: bring to front
        // Create inventory panel
        this.inventoryPanel = document.createElement('div');
        this.inventoryPanel.id = 'inventoryPanel';
        this.inventoryPanel.className = 'inventory-panel';
        this.inventoryPanel.style.display = 'none';
        const inventoryContent = document.createElement('div');
        inventoryContent.className = 'inventory-content';
        this.inventoryPanel.appendChild(inventoryContent);
        document.body.appendChild(this.inventoryPanel);
        // Create crafting panel
        this.craftingPanel = document.createElement('div');
        this.craftingPanel.id = 'craftingPanel';
        this.craftingPanel.className = 'crafting-panel';
        this.craftingPanel.style.display = 'none';
        const craftingContent = document.createElement('div');
        craftingContent.className = 'crafting-content';
        const title = document.createElement('h2');
        title.textContent = 'Crafting';
        craftingContent.appendChild(title);
        const craftingMain = document.createElement('div');
        craftingMain.className = 'crafting-main';
        craftingMain.style.flex = '0 0 50%';
        const craftingCircleContainer = document.createElement('div');
        craftingCircleContainer.className = 'crafting-circle-container';
        for (let i = 0; i < 5; i++) {
            const slot = document.createElement('div');
            slot.className = 'crafting-slot';
            slot.dataset.index = i.toString();
            craftingCircleContainer.appendChild(slot);
        }
        const multiplierText = document.createElement('div');
        multiplierText.className = 'crafting-multiplier';
        craftingCircleContainer.appendChild(multiplierText);
        craftingMain.appendChild(craftingCircleContainer);
        const craftingActions = document.createElement('div');
        craftingActions.className = 'crafting-actions';
        const craftButton = document.createElement('button');
        craftButton.className = 'craft-button';
        craftButton.textContent = 'Craft';
        craftButton.addEventListener('click', () => this.craftItems());
        craftingActions.appendChild(craftButton);
        const successChance = document.createElement('div');
        successChance.className = 'success-chance';
        successChance.textContent = 'Success Chance: 0%';
        craftingActions.appendChild(successChance);
        craftingMain.appendChild(craftingActions);
        craftingContent.appendChild(craftingMain);
        // Create inventory preview section
        const inventoryPreview = document.createElement('div');
        inventoryPreview.className = 'crafting-inventory-preview';
        const previewTitle = document.createElement('h3');
        previewTitle.textContent = 'Inventory';
        inventoryPreview.appendChild(previewTitle);
        const inventoryGrid = document.createElement('div');
        inventoryGrid.className = 'crafting-inventory-grid';
        inventoryPreview.appendChild(inventoryGrid);
        craftingContent.appendChild(inventoryPreview);
        this.craftingPanel.appendChild(craftingContent);
        document.body.appendChild(this.craftingPanel);
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .crafting-main {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 15px;
                margin-bottom: 15px;
                max-height: none;
            }
            .crafting-circle-container {
                position: relative;
                width: 180px;
                height: 180px;
                flex-shrink: 0;
            }
            .crafting-slot {
                width: 40px;
                height: 40px;
                position: absolute;
                cursor: pointer !important;
                user-select: none;
            }
            .crafting-multiplier {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 24px;
                font-weight: bold;
                color: white;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                display: none;
            }
            .crafting-actions {
                display: flex;
                flex-direction: column;
                gap: 8px;
                flex-shrink: 0;
            }
            .crafting-inventory-preview {
                margin-top: 15px;
                border-top: 2px solid #444;
                padding-top: 10px;
                flex: 1 1 auto;
                overflow-y: auto;
            }
            .crafting-slot {
                cursor: pointer !important;
                user-select: none;
            }
            .crafting-slot img {
                pointer-events: none;
            }
            .loadout-slot.on-cooldown {
                position: relative;
                overflow: hidden;
            }
            .loadout-slot.on-cooldown::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                animation: cooldown 10s linear;
            }
            @keyframes cooldown {
                from { height: 100%; }
                to { height: 0%; }
            }
        `;
        document.head.appendChild(style);
        // Setup drag and drop
        this.setupDragAndDrop();
    }
    getLoadoutKeyBindings() {
        return this.LOADOUT_KEY_BINDINGS;
    }
    hideChat() {
        if (this.chat?.chatContainer) {
            this.chat.chatContainer.setAttribute('z-index', '0');
            this.chat.chatInput?.setAttribute('z-index', '0');
            this.chat.hide();
        }
    }
    showChat() {
        if (this.chat?.chatContainer) {
            this.chat.chatContainer.setAttribute('z-index', '1000');
            this.chat.chatInput?.setAttribute('z-index', '1000');
            this.chat.show();
        }
    }
    toggleInventory() {
        if (!this.inventoryPanel)
            return;
        const isOpen = this.inventoryPanel.style.display === 'block';
        if (!isOpen) {
            this.inventoryPanel.style.display = 'block';
            this.hideChat();
            setTimeout(() => {
                this.inventoryPanel?.classList.add('open');
            }, 10);
            this.updateInventoryDisplay();
        }
        else {
            this.inventoryPanel.classList.remove('open');
            this.showChat();
            setTimeout(() => {
                if (this.inventoryPanel) {
                    this.inventoryPanel.style.display = 'none';
                }
            }, 300);
        }
        this.isInventoryOpen = !isOpen;
    }
    toggleCrafting() {
        if (!this.craftingPanel)
            return;
        const isOpen = this.craftingPanel.classList.contains('open');
        if (!isOpen) {
            this.craftingPanel.style.display = 'block';
            this.hideChat();
            setTimeout(() => {
                this.craftingPanel?.classList.add('open');
            }, 10);
            this.updateCraftingDisplay();
        }
        else {
            this.craftingPanel.classList.remove('open');
            this.showChat();
            setTimeout(() => {
                if (this.craftingPanel) {
                    this.craftingPanel.style.display = 'none';
                }
            }, 300);
        }
        this.isCraftingOpen = !isOpen;
    }
    equipItemToLoadout(rarity, type, loadoutSlot) {
        const player = this.game.getLocalPlayer();
        if (!player || loadoutSlot >= this.LOADOUT_SLOTS || this.getItemCount(rarity, type) === 0)
            return;
        // Parse petal type if it's a petal
        let itemType;
        let petalType;
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6); // Remove 'petal_' prefix
        }
        else {
            itemType = type;
        }
        const item = {
            type: itemType,
            rarity: rarity,
            petalType: petalType
        };
        // Initialize health for petals
        if (itemType === 'petal' && petalType && rarity) {
            const stats = (0,src_petals/* getPetalStats */.q)(petalType, rarity);
            if (stats) {
                item.health = stats.health;
                item.maxHealth = stats.health;
            }
        }
        const newInventory = { ...player.inventory };
        const newLoadout = [...player.loadout];
        this.removeItem(rarity, type, 1);
        const existingItem = newLoadout[loadoutSlot];
        if (existingItem && existingItem.rarity) {
            const existingKey = existingItem.type === 'petal' ? `${existingItem.type}_${existingItem.petalType}` : existingItem.type;
            this.addItem(existingItem.rarity, existingKey, 1);
        }
        newLoadout[loadoutSlot] = item;
        player.loadout = newLoadout;
        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: player.inventory
        });
        requestAnimationFrame(() => {
            this.updateInventoryDisplay();
            this.updateLoadoutDisplay();
        });
    }
    useLoadoutItem(slot) {
        const player = this.game.getLocalPlayer();
        if (!player || !player.loadout[slot])
            return;
        const item = player.loadout[slot];
        if (item.onCooldown)
            return;
        // Petals cannot be used as consumables
        if (item.type === 'petal') {
            this.game.showFloatingText(this.game.canvas.width / 2, 50, 'Petals cannot be used - they provide passive protection!', '#FFA500', 16);
            return;
        }
        this.game.getSocket()?.emit('useItem', { type: item.type, rarity: item.rarity });
        const rarityMultipliers = {
            common: 1,
            uncommon: 1.5,
            rare: 2,
            epic: 2.5,
            legendary: 3,
            mythic: 4,
            ultra: 5,
            super: 6,
            unique: 7
        };
        const multiplier = item.rarity ? rarityMultipliers[item.rarity] : 1;
        switch (item.type) {
            case 'health_potion':
                this.game.showFloatingText(player.x, player.y - 30, `+${Math.floor(50 * multiplier)} HP`, '#32CD32', 20);
                break;
            case 'speed_boost':
                this.game.showFloatingText(player.x, player.y - 30, `Speed Boost (${Math.floor(5 * multiplier)}s)`, '#4169E1', 20);
                break;
            case 'shield':
                this.game.showFloatingText(player.x, player.y - 30, `Shield (${Math.floor(3 * multiplier)}s)`, '#FFD700', 20);
                break;
        }
        const slot_element = document.querySelector(`.loadout-slot[data-slot="${slot}"]`);
        if (slot_element) {
            slot_element.classList.add('on-cooldown');
            const cooldownTime = 10000 * (1 / multiplier);
            setTimeout(() => {
                slot_element.classList.remove('on-cooldown');
            }, cooldownTime);
        }
        if (this.isInventoryOpen) {
            this.updateInventoryDisplay();
        }
        this.updateLoadoutDisplay();
    }
    updateLoadoutDisplay() {
        const player = this.game.getLocalPlayer();
        if (!player) {
            console.warn('Player not yet initialized for loadout update');
            return;
        }
        console.log('Updating loadout display with loadout:', player.loadout.map(item => item ? item.type : null));
        const slots = document.querySelectorAll('.loadout-slot');
        console.log('Found ' + slots.length + ' loadout slots');
        slots.forEach((slot, index) => {
            slot.innerHTML = '';
            slot.classList.remove('on-cooldown', 'petal-slot');
            const item = player.loadout[index];
            if (item) {
                // Handle cooldown state
                if (item.onCooldown) {
                    slot.classList.add('on-cooldown');
                }
                // Handle different item types
                if (item.type === 'petal') {
                    slot.classList.add('petal-slot');
                    // Create petal visual using SVG image
                    const petalDiv = document.createElement('div');
                    petalDiv.style.width = '80%';
                    petalDiv.style.height = '80%';
                    petalDiv.style.display = 'flex';
                    petalDiv.style.alignItems = 'center';
                    petalDiv.style.justifyContent = 'center';
                    // Get petal SVG from stats
                    if (item.petalType && item.rarity) {
                        const stats = (0,src_petals/* getPetalStats */.q)(item.petalType, item.rarity);
                        if (stats && stats.image) {
                            // Create an image element with the SVG data
                            const img = document.createElement('img');
                            img.style.width = '100%';
                            img.style.height = '100%';
                            img.style.objectFit = 'contain';
                            // Convert SVG string to blob URL (same as graphics system)
                            const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                            const url = URL.createObjectURL(svgBlob);
                            img.src = url;
                            petalDiv.appendChild(img);
                        }
                        else {
                            // Fallback to colored circle
                            petalDiv.style.borderRadius = '50%';
                            petalDiv.style.border = '2px solid #000';
                            petalDiv.style.backgroundColor = '#90EE90'; // Default green
                        }
                    }
                    else {
                        // Fallback to colored circle
                        petalDiv.style.borderRadius = '50%';
                        petalDiv.style.border = '2px solid #000';
                        petalDiv.style.backgroundColor = '#90EE90'; // Default green
                    }
                    // Show health bar for petals
                    if (item.health !== undefined && item.maxHealth !== undefined && item.maxHealth > 0) {
                        const healthBar = document.createElement('div');
                        healthBar.style.position = 'absolute';
                        healthBar.style.bottom = '0';
                        healthBar.style.left = '0';
                        healthBar.style.width = '100%';
                        healthBar.style.height = '3px';
                        healthBar.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
                        const healthFill = document.createElement('div');
                        const healthPercentage = item.health / item.maxHealth;
                        healthFill.style.width = `${healthPercentage * 100}%`;
                        healthFill.style.height = '100%';
                        healthFill.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
                        healthBar.appendChild(healthFill);
                        slot.appendChild(healthBar);
                    }
                    slot.appendChild(petalDiv);
                }
                else {
                    // Regular items (health potion, speed boost, shield)
                    const img = document.createElement('img');
                    img.src = `./assets/${item.type}.png`;
                    img.alt = item.type;
                    img.style.width = '80%';
                    img.style.height = '80%';
                    img.style.objectFit = 'contain';
                    slot.appendChild(img);
                }
            }
            const keyText = document.createElement('div');
            keyText.className = 'key-binding';
            keyText.textContent = this.LOADOUT_KEY_BINDINGS[index];
            slot.appendChild(keyText);
        });
    }
    setupDragAndDrop() {
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            const dragEvent = e;
            const target = e.target;
            if (!target.closest('.loadout-slot') && !target.closest('.inventory-grid')) {
                const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (loadoutSlot) {
                    this.moveItemToInventory(parseInt(loadoutSlot));
                }
            }
        });
        const updateLoadoutDraggable = () => {
            const slots = document.querySelectorAll('.loadout-slot');
            slots.forEach((slot, slotIndex) => {
                const img = slot.querySelector('img');
                if (img) {
                    img.draggable = true;
                    img.addEventListener('dragstart', (e) => {
                        const dragEvent = e;
                        dragEvent.dataTransfer?.setData('text/loadoutSlot', slotIndex.toString());
                        dragEvent.dataTransfer.effectAllowed = 'move';
                    });
                }
            });
        };
        const originalUpdateLoadoutDisplay = this.updateLoadoutDisplay.bind(this);
        this.updateLoadoutDisplay = () => {
            originalUpdateLoadoutDisplay();
            updateLoadoutDraggable();
        };
        const slots = document.querySelectorAll('.loadout-slot');
        slots.forEach((slot, slotIndex) => {
            slot.dataset.slot = slotIndex.toString();
            slot.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.currentTarget.classList.add('drag-over');
            });
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragEvent = e;
                dragEvent.dataTransfer.dropEffect = 'move';
                e.currentTarget.classList.add('drag-over');
            });
            slot.addEventListener('dragleave', (e) => {
                e.currentTarget.classList.remove('drag-over');
            });
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                const dragEvent = e;
                const target = e.currentTarget;
                target.classList.remove('drag-over');
                const itemData = dragEvent.dataTransfer?.getData('text/plain');
                const fromLoadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (itemData) {
                    const { rarity, type } = JSON.parse(itemData);
                    const slot = parseInt(target.dataset.slot || '-1');
                    if (rarity && type && slot >= 0) {
                        this.equipItemToLoadout(rarity, type, slot);
                    }
                }
                else if (fromLoadoutSlot) {
                    const fromSlot = parseInt(fromLoadoutSlot);
                    const toSlot = slotIndex;
                    if (fromSlot !== toSlot) {
                        this.swapLoadoutItems(fromSlot, toSlot);
                    }
                }
            });
        });
        const craftingSlots = this.craftingPanel?.querySelectorAll('.crafting-slot');
        craftingSlots?.forEach(slot => {
            slot.addEventListener('click', () => {
                this.removeCraftingBatch();
            });
        });
        if (this.inventoryPanel) {
            const grid = this.inventoryPanel.querySelector('.inventory-grid');
            if (grid) {
                grid.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    const dragEvent = e;
                    dragEvent.dataTransfer.dropEffect = 'move';
                    grid.classList.add('drag-over');
                });
                grid.addEventListener('dragleave', (e) => {
                    grid.classList.remove('drag-over');
                });
                grid.addEventListener('drop', (e) => {
                    e.preventDefault();
                    grid.classList.remove('drag-over');
                    const dragEvent = e;
                    const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                    if (loadoutSlot) {
                        this.moveItemToInventory(parseInt(loadoutSlot));
                    }
                });
            }
        }
    }
    swapLoadoutItems(fromSlot, toSlot) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const newLoadout = [...player.loadout];
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        player.loadout = newLoadout;
        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: player.inventory
        });
        this.updateLoadoutDisplay();
    }
    updateInventoryDisplay() {
        if (!this.inventoryPanel)
            return;
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        // Safety check: ensure inventory exists and is properly initialized
        if (!player.inventory || typeof player.inventory !== 'object') {
            console.warn('[INVENTORY] Player inventory is not properly initialized:', player.inventory);
            // Initialize empty inventory if missing
            player.inventory = {};
            return;
        }
        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content)
            return;
        content.innerHTML = '';
        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);
        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
        const gridContainer = document.createElement('div');
        gridContainer.className = 'inventory-grid-container';
        gridContainer.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
      `;
        rarities.forEach(rarity => {
            const items = player.inventory[rarity];
            if (items && Object.keys(items).length > 0) {
                const rarityRow = document.createElement('div');
                rarityRow.className = 'rarity-row';
                rarityRow.style.cssText = `
                  display: flex;
                  flex-direction: column;
                  gap: 5px;
              `;
                const rarityLabel = document.createElement('div');
                rarityLabel.textContent = rarity.toUpperCase();
                rarityLabel.style.cssText = `
                  color: ${this.ITEM_RARITY_COLORS[rarity]};
                  font-weight: bold;
                  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
                  padding-left: 5px;
              `;
                rarityRow.appendChild(rarityLabel);
                const grid = document.createElement('div');
                grid.className = 'inventory-grid';
                grid.style.cssText = `
                  display: flex;
                  flex-wrap: wrap;
                  gap: 5px;
                  padding: 5px;
                  background: rgba(0, 0, 0, 0.2);
                  border-radius: 5px;
                  border: 1px solid ${this.ITEM_RARITY_COLORS[rarity]}40;
              `;
                Object.entries(items).forEach(([type, count]) => {
                    const itemElement = document.createElement('div');
                    itemElement.className = 'inventory-item';
                    itemElement.draggable = true;
                    itemElement.style.cssText = `
                      position: relative;
                      width: 50px;
                      height: 50px;
                      background-color: ${this.ITEM_RARITY_COLORS[rarity]}20;
                      border: 2px solid ${this.ITEM_RARITY_COLORS[rarity]};
                      border-radius: 5px;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      cursor: pointer;
                      transition: all 0.2s ease;
                  `;
                    itemElement.addEventListener('mouseover', () => {
                        itemElement.style.transform = 'scale(1.05)';
                        itemElement.style.boxShadow = `0 0 10px ${this.ITEM_RARITY_COLORS[rarity]}`;
                    });
                    itemElement.addEventListener('mouseout', () => {
                        itemElement.style.transform = 'scale(1)';
                        itemElement.style.boxShadow = 'none';
                    });
                    itemElement.addEventListener('dragstart', (e) => {
                        e.dataTransfer?.setData('text/plain', JSON.stringify({ rarity, type }));
                        itemElement.classList.add('dragging');
                    });
                    itemElement.addEventListener('dragend', () => {
                        itemElement.classList.remove('dragging');
                    });
                    // Handle different item types for display
                    if (type.startsWith('petal_')) {
                        // Handle petal items with SVG
                        const petalType = type.replace('petal_', '');
                        const stats = (0,src_petals/* getPetalStats */.q)(petalType, rarity);
                        if (stats && stats.image) {
                            const img = document.createElement('img');
                            img.alt = type;
                            img.draggable = false;
                            img.style.cssText = `
                              width: 40px;
                              height: 40px;
                              object-fit: contain;
                          `;
                            // Convert SVG string to blob URL (same as loadout display)
                            const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                            const url = URL.createObjectURL(svgBlob);
                            img.src = url;
                            itemElement.appendChild(img);
                        }
                        else {
                            // Fallback to colored circle for petals
                            const fallbackDiv = document.createElement('div');
                            fallbackDiv.style.cssText = `
                              width: 40px;
                              height: 40px;
                              border-radius: 50%;
                              background-color: #90EE90;
                              border: 2px solid #000;
                          `;
                            itemElement.appendChild(fallbackDiv);
                        }
                    }
                    else {
                        // Handle other items with PNG images
                        const img = document.createElement('img');
                        img.src = `./assets/${type}.png`;
                        img.alt = type;
                        img.draggable = false;
                        img.style.cssText = `
                          width: 40px;
                          height: 40px;
                          object-fit: contain;
                      `;
                        itemElement.appendChild(img);
                    }
                    const countLabel = document.createElement('div');
                    countLabel.className = 'item-count';
                    countLabel.textContent = count.toString();
                    countLabel.style.cssText = `
                        position: absolute;
                        bottom: 2px;
                        right: 4px;
                        color: white;
                        font-size: 14px;
                        font-weight: bold;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                    `;
                    itemElement.appendChild(countLabel);
                    grid.appendChild(itemElement);
                });
                rarityRow.appendChild(grid);
                gridContainer.appendChild(rarityRow);
            }
        });
        content.appendChild(gridContainer);
    }
    moveItemToInventory(loadoutSlot) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        // Safety check: ensure loadout exists and is properly initialized
        if (!player.loadout || !Array.isArray(player.loadout) || loadoutSlot >= player.loadout.length) {
            console.warn(`[INVENTORY] Invalid loadout access: slot ${loadoutSlot}, loadout:`, player.loadout);
            return;
        }
        const item = player.loadout[loadoutSlot];
        if (!item || !item.rarity)
            return;
        const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
        this.addItem(item.rarity, itemKey, 1);
        const newLoadout = [...player.loadout];
        newLoadout[loadoutSlot] = null;
        player.loadout = newLoadout;
        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: player.inventory
        });
        requestAnimationFrame(() => {
            this.updateInventoryDisplay();
            this.updateLoadoutDisplay();
        });
    }
    addItemToCraftingSlot(rarity, type, slotIndex) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        if (this.getItemCount(rarity, type) === 0)
            return;
        let itemType;
        let petalType;
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6);
        }
        else {
            itemType = type;
        }
        const item = {
            type: itemType,
            rarity: rarity,
            petalType: petalType
        };
        if (this.craftingItems[slotIndex]) {
            return;
        }
        const existingItems = this.craftingItems.filter(slot => slot !== null);
        if (existingItems.length > 0) {
            const firstItem = existingItems[0];
            if (item.type !== firstItem.type || item.rarity !== firstItem.rarity || item.petalType !== firstItem.petalType) {
                this.game.showFloatingText(this.game.canvas.width / 2, 50, 'Items must be of the same type and rarity!', '#FF0000', 20);
                return;
            }
        }
        this.craftingItems[slotIndex] = item;
        this.removeItem(rarity, type, 1);
        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }
    handleCraftingItemClick(rarity, type, isShiftClick) {
        const itemsFromStack = this.getItemCount(rarity, type);
        if (itemsFromStack === 0)
            return;
        const isPetal = type.startsWith('petal_');
        const petalType = isPetal ? type.substring(6) : undefined;
        const itemType = isPetal ? 'petal' : type;
        if (this.craftingItems.length > 0) {
            const firstItem = this.craftingItems[0];
            if (firstItem.rarity !== rarity || firstItem.type !== itemType || firstItem.petalType !== petalType) {
                const itemsToReturn = [...this.craftingItems];
                this.craftingItems = [];
                itemsToReturn.forEach(item => {
                    const itemKey = item.petalType ? `petal_${item.petalType}` : item.type;
                    this.addItem(item.rarity, itemKey, 1);
                });
            }
        }
        let amountToAdd;
        if (isShiftClick) {
            amountToAdd = itemsFromStack;
        }
        else {
            amountToAdd = 5;
        }
        const actualAmountToAdd = Math.min(amountToAdd, this.getItemCount(rarity, type));
        if (actualAmountToAdd < 5) {
            this.game.showFloatingText(this.game.canvas.width / 2, 50, 'You need at least 5 items to add a batch.', '#FF0000', 20);
            return;
        }
        const batchesToAdd = Math.floor(actualAmountToAdd / 5);
        const totalItemsToAdd = batchesToAdd * 5;
        const item = {
            type: itemType,
            rarity: rarity,
            petalType: petalType
        };
        for (let i = 0; i < totalItemsToAdd; i++) {
            this.craftingItems.push(item);
        }
        this.removeItem(rarity, type, totalItemsToAdd);
        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }
    removeCraftingBatch() {
        if (this.craftingItems.length === 0)
            return;
        const itemsToRemove = this.craftingItems.splice(-5);
        if (itemsToRemove.length > 0) {
            const item = itemsToRemove[0];
            const type = item.petalType ? `petal_${item.petalType}` : item.type;
            if (item.rarity) {
                this.addItem(item.rarity, type, itemsToRemove.length);
            }
        }
        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }
    craftItems() {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const itemsToCraftCount = this.craftingItems.length;
        if (itemsToCraftCount < 5 || itemsToCraftCount % 5 !== 0) {
            this.game.showFloatingText(this.game.canvas.width / 2, 50, 'You must add items in multiples of 5 to craft!', '#FF0000', 20);
            return;
        }
        this.game.getSocket()?.emit('craftItems', { items: this.craftingItems });
        this.craftingItems = [];
        this.updateCraftingDisplay();
    }
    updateCraftingDisplay() {
        if (!this.craftingPanel)
            return;
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const slots = this.craftingPanel.querySelectorAll('.crafting-slot');
        const container = this.craftingPanel.querySelector('.crafting-circle-container');
        const multiplierEl = this.craftingPanel.querySelector('.crafting-multiplier');
        const radius = 70;
        const containerSize = 180;
        if (this.craftingItems.length > 0) {
            const firstItem = this.craftingItems[0];
            const attempts = this.craftingItems.length / 5;
            multiplierEl.textContent = `x${attempts}`;
            multiplierEl.style.display = 'block';
            slots.forEach((slot, index) => {
                if (container) {
                    const angle = (index / slots.length) * 2 * Math.PI;
                    const x = (containerSize / 2) + radius * Math.cos(angle) - 20;
                    const y = (containerSize / 2) + radius * Math.sin(angle) - 20;
                    slot.style.left = `${x}px`;
                    slot.style.top = `${y}px`;
                }
                slot.innerHTML = '';
                slot.style.borderColor = this.ITEM_RARITY_COLORS[firstItem.rarity];
                if (firstItem.type === 'petal' && firstItem.petalType && firstItem.rarity) {
                    const stats = (0,src_petals/* getPetalStats */.q)(firstItem.petalType, firstItem.rarity);
                    if (stats && stats.image) {
                        const img = document.createElement('img');
                        img.style.width = '100%';
                        img.style.height = '100%';
                        img.style.objectFit = 'contain';
                        const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                        img.src = URL.createObjectURL(svgBlob);
                        slot.appendChild(img);
                    }
                }
                else {
                    const img = document.createElement('img');
                    img.src = `./assets/${firstItem.type}.png`;
                    img.alt = firstItem.type;
                    img.style.width = '80%';
                    img.style.height = '80%';
                    img.style.objectFit = 'contain';
                    slot.appendChild(img);
                }
            });
        }
        else {
            multiplierEl.style.display = 'none';
            slots.forEach((slot, index) => {
                if (container) {
                    const angle = (index / slots.length) * 2 * Math.PI;
                    const x = (containerSize / 2) + radius * Math.cos(angle) - 20;
                    const y = (containerSize / 2) + radius * Math.sin(angle) - 20;
                    slot.style.left = `${x}px`;
                    slot.style.top = `${y}px`;
                }
                slot.innerHTML = '';
                slot.style.borderColor = '#666';
            });
        }
        // Calculate and update success chance
        const successChance = this.calculateSuccessChance();
        const successElement = this.craftingPanel.querySelector('.success-chance');
        if (successElement) {
            successElement.textContent = `Success Chance: ${successChance}%`;
        }
        // Update inventory preview
        this.updateCraftingInventoryPreview();
    }
    calculateSuccessChance() {
        const items = this.craftingItems;
        if (items.length === 0)
            return 0;
        // Group items by rarity
        const rarityCounts = {};
        items.forEach(item => {
            if (item.rarity) {
                rarityCounts[item.rarity] = (rarityCounts[item.rarity] || 0) + 1;
            }
        });
        // Calculate success chance based on rarity progression
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        let baseChance = 64; // 64% for common->uncommon
        // Find the highest rarity in the crafting slots
        let highestRarityIndex = -1;
        for (const rarity of rarities) {
            if (rarityCounts[rarity] > 0) {
                highestRarityIndex = rarities.indexOf(rarity);
            }
        }
        if (highestRarityIndex === -1)
            return 0;
        // Halve the chance for each rarity level above common
        const chance = baseChance / Math.pow(2, highestRarityIndex);
        return Math.round(chance);
    }
    calculatePetalCount() {
        const player = this.game.getLocalPlayer();
        if (!player)
            return 0;
        let totalPetals = 0;
        const petalRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        petalRarities.forEach(rarity => {
            const petalCount = player.inventory[rarity]?.['petal'] || 0;
            totalPetals += petalCount;
        });
        return totalPetals;
    }
    updateCraftingInventoryPreview() {
        const inventoryGrid = this.craftingPanel?.querySelector('.crafting-inventory-grid');
        if (!inventoryGrid)
            return;
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        inventoryGrid.innerHTML = '';
        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
        rarities.forEach(rarity => {
            const rarityItems = player.inventory[rarity];
            if (rarityItems) {
                Object.entries(rarityItems).forEach(([itemType, count]) => {
                    if (count > 0) {
                        const itemElement = document.createElement('div');
                        itemElement.className = 'crafting-inventory-item';
                        itemElement.dataset.rarity = rarity;
                        itemElement.dataset.type = itemType;
                        itemElement.dataset.count = count.toString();
                        // Create container for item display
                        const itemContainer = document.createElement('div');
                        itemContainer.style.position = 'relative';
                        itemContainer.style.width = '100%';
                        itemContainer.style.height = '100%';
                        itemContainer.style.display = 'flex';
                        itemContainer.style.flexDirection = 'column';
                        itemContainer.style.alignItems = 'center';
                        itemContainer.style.justifyContent = 'center';
                        // Handle different item types
                        if (itemType.includes('petal_')) {
                            // Create petal visual using SVG image
                            const petalDiv = document.createElement('div');
                            petalDiv.style.width = '60%';
                            petalDiv.style.height = '60%';
                            petalDiv.style.display = 'flex';
                            petalDiv.style.alignItems = 'center';
                            petalDiv.style.justifyContent = 'center';
                            // Get petal SVG from stats
                            const stats = (0,src_petals/* getPetalStats */.q)(itemType.replace('petal_', ''), rarity);
                            if (stats && stats.image) {
                                // Create an image element with the SVG data
                                const img = document.createElement('img');
                                img.style.width = '100%';
                                img.style.height = '100%';
                                img.style.objectFit = 'contain';
                                // Convert SVG string to blob URL (same as graphics system)
                                const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                                const url = URL.createObjectURL(svgBlob);
                                img.src = url;
                                petalDiv.appendChild(img);
                            }
                            else {
                                // Fallback to colored circle
                                petalDiv.style.borderRadius = '50%';
                                petalDiv.style.border = '2px solid #000';
                                petalDiv.style.backgroundColor = '#90EE90'; // Default green
                            }
                            itemContainer.appendChild(petalDiv);
                        }
                        else {
                            // Handle other item types with PNG images
                            const img = document.createElement('img');
                            img.src = `./assets/${itemType}.png`;
                            img.alt = itemType;
                            img.style.width = '60%';
                            img.style.height = '60%';
                            img.style.objectFit = 'contain';
                            itemContainer.appendChild(img);
                        }
                        // Add count display
                        const countDisplay = document.createElement('div');
                        countDisplay.style.position = 'absolute';
                        countDisplay.style.top = '2px';
                        countDisplay.style.right = '2px';
                        countDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
                        countDisplay.style.color = 'white';
                        countDisplay.style.fontSize = '10px';
                        countDisplay.style.padding = '1px 3px';
                        countDisplay.style.borderRadius = '3px';
                        countDisplay.style.fontWeight = 'bold';
                        countDisplay.textContent = count.toString();
                        itemContainer.appendChild(countDisplay);
                        // Add rarity indicator
                        const rarityDisplay = document.createElement('div');
                        rarityDisplay.style.position = 'absolute';
                        rarityDisplay.style.bottom = '2px';
                        rarityDisplay.style.left = '2px';
                        rarityDisplay.style.backgroundColor = this.ITEM_RARITY_COLORS[rarity] || '#666';
                        rarityDisplay.style.color = 'white';
                        rarityDisplay.style.fontSize = '8px';
                        rarityDisplay.style.padding = '1px 2px';
                        rarityDisplay.style.borderRadius = '2px';
                        rarityDisplay.style.fontWeight = 'bold';
                        rarityDisplay.textContent = rarity.charAt(0).toUpperCase();
                        itemContainer.appendChild(rarityDisplay);
                        itemElement.appendChild(itemContainer);
                        itemElement.addEventListener('click', (e) => {
                            this.handleCraftingItemClick(rarity, itemType, e.shiftKey);
                        });
                        inventoryGrid.appendChild(itemElement);
                    }
                });
            }
        });
    }
    cleanup() {
        if (this.inventoryPanel)
            this.inventoryPanel.style.display = 'none';
        if (this.craftingPanel)
            this.craftingPanel.style.display = 'none';
        const loadoutBar = document.getElementById('loadoutBar');
        if (loadoutBar) {
            loadoutBar.remove();
        }
    }
    getItemCount(rarity, type) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return 0;
        return player.inventory[rarity]?.[type] || 0;
    }
    addItem(rarity, type, count) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        if (!player.inventory[rarity]) {
            player.inventory[rarity] = {};
        }
        if (!player.inventory[rarity][type]) {
            player.inventory[rarity][type] = 0;
        }
        player.inventory[rarity][type] += count;
    }
    removeItem(rarity, type, count) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        if (this.getItemCount(rarity, type) >= count) {
            player.inventory[rarity][type] -= count;
            if (player.inventory[rarity][type] === 0) {
                delete player.inventory[rarity][type];
                if (Object.keys(player.inventory[rarity]).length === 0) {
                    delete player.inventory[rarity];
                }
            }
        }
    }
}

;// ./src/game.ts







class Game {
    constructor(showHitboxes, serverIp) {
        this.speedBoostActive = false;
        this.shieldActive = false;
        this.debugCollision = false; // Toggle for collision debugging
        this.players = new Map();
        this.playerSprite = new Image();
        this.dots = [];
        this.DOT_SIZE = 5;
        this.DOT_COUNT = 20;
        this.PLAYER_ACCELERATION = 0.5; // Adjusted for smoother acceleration
        this.MAX_SPEED = 90; // Further increased speed for better responsiveness
        // private readonly FRICTION = 0.95;        // Removed sliding physics
        this.cameraX = 0;
        this.cameraY = 0;
        this.playerEye = { x: 0, y: 0 };
        this.targetEye = { x: 0, y: 0 };
        this.zoomLevel = 1.0;
        // Viewport animation properties
        this.isAnimatingViewport = false;
        this.animationStartTime = 0;
        this.animationDuration = 1000; // 1 second for each animation phase
        this.animationStartPos = { x: 0, y: 0 };
        this.animationTargetPos = { x: 0, y: 0 };
        this.animationPhase = 'none';
        this.savedPlayerPos = { x: 0, y: 0 };
        this.MIN_ZOOM = 0.5;
        this.MAX_ZOOM = 3.0;
        this.ZOOM_STEP = 0.1;
        this.WORLD_WIDTH = ACTUAL_WORLD_WIDTH; // Increased from 2000 to 10000
        this.WORLD_HEIGHT = ACTUAL_WORLD_HEIGHT; // Keep height the same
        this.keysPressed = new Set();
        this.petalExtension = 1.0; // 1.0 = normal, >1.0 = extended, <1.0 = retracted
        this.enemies = new Map();
        this.octopusSprite = new Image();
        this.fishSprite = new Image();
        this.coralSprite = new Image();
        this.palmSprite = new Image();
        this.PLAYER_MAX_HEALTH = 100;
        this.PLAYER_DAMAGE = 10;
        this.ENEMY_DAMAGE = 5;
        this.DAMAGE_COOLDOWN = 1000; // 1 second cooldown
        this.lastDamageTime = 0;
        this.obstacles = [];
        this.ENEMY_CORAL_MAX_HEALTH = 50;
        this.items = new Map();
        this.itemSprites = {};
        this.isInventoryOpen = false;
        this.gameLoopId = null;
        this.socketHandlers = new Map();
        this.BASE_XP_REQUIREMENT = 100;
        this.XP_MULTIPLIER = 1.5;
        this.MAX_LEVEL = 50;
        this.HEALTH_PER_LEVEL = 10;
        this.DAMAGE_PER_LEVEL = 2;
        // Add this property to store floating texts
        this.floatingTexts = [];
        // Add enemy size multipliers as a class property
        // Add property to track if player is dead
        this.isPlayerDead = false;
        // Add minimap properties
        this.MINIMAP_WIDTH = 200; // Increased from 40
        this.MINIMAP_HEIGHT = 200; // Made square for better visibility
        this.MINIMAP_PADDING = 10;
        // Add decoration-related properties
        this.decorations = [];
        // Add sand property
        this.sands = [];
        // Add control mode property
        this.useMouseControls = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.showHitboxes = false; // Changed from true to false
        this.playerHue = 0;
        this.playerColor = 'hsl(0, 100%, 50%)';
        this.LOADOUT_SLOTS = 10;
        this.LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
        // Add to class properties
        this.inventoryPanel = null;
        this.saveIndicator = null;
        this.saveIndicatorTimeout = null;
        // Add to class properties
        this.chatContainer = null;
        this.chatInput = null;
        this.chatMessages = null;
        this.isChatFocused = false;
        // Add to Game class properties
        this.pendingScripts = new Map();
        // Add to Game class properties
        this.ITEM_RARITY_COLORS = {
            common: '#808080', // Gray
            uncommon: '#008000', // Green
            rare: '#0000FF', // Blue
            epic: '#800080', // Purple
            legendary: '#FFA500', // Orange
            mythic: '#FF0000' // Red
        };
        // Add to Game class properties
        this.craftingPanel = null;
        this.craftingSlots = Array(4).fill(null).map((_, i) => ({ index: i, item: null }));
        this.isCraftingOpen = false;
        // Add to class properties
        this.walls = [];
        this.WALL_SPACING = 500; // Distance between walls
        this.world_map_data = [];
        // Add map rendering properties
        this.lastUpdateTime = 0; // Add this property for delta time
        this.lastServerUpdate = 0;
        this.lastHeartbeat = 0;
        this.heartbeatInterval = null; // Add this property for server update time
        // Add to class properties at the top
        this.backgroundImage = new Image();
        this.wallTexture = new Image(); // Add this to class properties
        this.backgroundTexture = new Image();
        this.healthPotionSprite = new Image();
        this.speedBoostSprite = new Image();
        this.shieldSprite = new Image();
        this.lastDeathTime = 0;
        this.deathCooldown = 3000; // 3 seconds
        this.lastMessageTime = 0; // Add this line
        this.messageCooldown = 1000; // 1 second cooldown
        this.gameStartTime = 0;
        // Add chat property
        this.chat = null;
        this.showHitboxes = showHitboxes;
        this.loadControls();
        //console.log('Game constructor called');
        this.canvas = document.getElementById('gameCanvas');
        this.graphics = new Graphics(this.canvas, this.playerSprite, this.wallTexture, this.octopusSprite, this.fishSprite, this.healthPotionSprite, this.speedBoostSprite, this.shieldSprite, this.backgroundTexture);
        this.graphics.showHitboxes = this.showHitboxes;
        // Set initial canvas size
        this.resizeCanvas();
        // Add resize listener
        window.addEventListener('resize', () => this.resizeCanvas());
        // Initialize sprites with CORS settings and wait for them to load
        Promise.all([
            this.initializeSprites(),
            this.setupItemSprites(),
            this.graphics.preloadPetalImages()
        ]).then(() => {
            console.log('All sprites loaded successfully');
            this.updateColorPreview();
            this.gameLoop();
        }).catch(console.error);
        // Create and set up preview canvas
        this.colorPreviewCanvas = document.createElement('canvas');
        this.colorPreviewCanvas.width = 64; // Set fixed size for preview
        this.colorPreviewCanvas.height = 64;
        this.colorPreviewCanvas.style.width = '64px';
        this.colorPreviewCanvas.style.height = '64px';
        this.colorPreviewCanvas.style.imageRendering = 'pixelated';
        // Add preview canvas to the color picker
        const previewContainer = document.createElement('div');
        previewContainer.style.display = 'flex';
        previewContainer.style.justifyContent = 'center';
        previewContainer.style.marginTop = '10px';
        previewContainer.appendChild(this.colorPreviewCanvas);
        document.querySelector('.color-picker')?.appendChild(previewContainer);
        // Set up color picker functionality
        const hueSlider = document.getElementById('hueSlider');
        const colorPreview = document.getElementById('colorPreview');
        if (hueSlider && colorPreview) {
            // Load saved hue from localStorage
            const savedHue = localStorage.getItem('playerHue');
            if (savedHue !== null) {
                this.playerHue = parseInt(savedHue);
                hueSlider.value = savedHue;
                this.playerColor = `hsl(${this.playerHue}, 100%, 50%)`;
                colorPreview.style.backgroundColor = this.playerColor;
                this.updateColorPreview();
            }
            // Preview color while sliding without saving
            hueSlider.addEventListener('input', (e) => {
                const value = e.target.value;
                colorPreview.style.backgroundColor = `hsl(${value}, 100%, 50%)`;
            });
            // Add update color button handler
            const updateColorButton = document.getElementById('updateColorButton');
            if (updateColorButton) {
                console.log('Update color button found');
                updateColorButton.addEventListener('click', () => {
                    const value = hueSlider.value;
                    localStorage.setItem('playerHue', value);
                    console.log('Player hue saved:', value);
                    // Update game state after saving
                    this.playerHue = parseInt(value);
                    this.playerColor = `hsl(${this.playerHue}, 100%, 50%)`;
                    if (this.playerSprite.complete) {
                        this.updateColorPreview();
                    }
                    // Show confirmation message
                    this.showFloatingText(this.canvas.width / 2, 50, 'Color Updated!', '#4CAF50', 20);
                });
            }
        }
        this.setupEventListeners();
        // Get title screen elements
        this.titleScreen = document.querySelector('.center_text');
        this.nameInput = document.getElementById('nameInput');
        // Initialize multiplayer mode after resource loading
        initMultiPlayerMode(this, serverIp);
        // Move authentication to after socket initialization
        this.authenticate();
        this.socket.on('inventoryUpdated', (inventory) => {
            const player = this.getLocalPlayer();
            if (player) {
                player.inventory = inventory;
                this.inventoryManager.updateInventoryDisplay();
            }
        });
        // Add respawn button listener
        const respawnButton = document.getElementById('respawnButton');
        respawnButton?.addEventListener('click', () => {
            if (this.isPlayerDead) {
                this.socket.emit('requestRespawn');
            }
        });
        // Add mouse move listener
        this.canvas.addEventListener('mousemove', (event) => {
            if (this.useMouseControls) {
                const rect = this.canvas.getBoundingClientRect();
                this.mouseX = event.clientX - rect.left + this.cameraX;
                this.mouseY = event.clientY - rect.top + this.cameraY;
            }
        });
        // Initialize exit button
        this.exitButton = document.getElementById('exitButton');
        this.exitButtonContainer = document.getElementById('exitButtonContainer');
        // Add exit button click handler
        this.exitButton?.addEventListener('click', () => this.handleExit());
        // Set up item sprites
        this.setupItemSprites();
        // Add drag-and-drop event listeners
        // this.setupDragAndDrop(); // This method is now in inventory.ts
        // Create inventory panel
        this.inventoryPanel = document.createElement('div');
        this.inventoryPanel.id = 'inventoryPanel';
        this.inventoryPanel.className = 'inventory-panel';
        this.inventoryPanel.style.display = 'none';
        // Create inventory content
        const inventoryContent = document.createElement('div');
        inventoryContent.className = 'inventory-content';
        this.inventoryPanel.appendChild(inventoryContent);
        document.body.appendChild(this.inventoryPanel);
        // Create save indicator
        this.saveIndicator = document.createElement('div');
        this.saveIndicator.className = 'save-indicator';
        this.saveIndicator.textContent = 'Progress Saved';
        this.saveIndicator.style.display = 'none';
        document.body.appendChild(this.saveIndicator);
        // Add this to the constructor after creating the loadout bar
        const style = document.createElement('style');
        style.textContent = `
          .loadout-slot.on-cooldown {
              position: relative;
              overflow: hidden;
          }
          .loadout-slot.on-cooldown::after {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: rgba(0, 0, 0, 0.5);
              animation: cooldown 10s linear;
          }
          @keyframes cooldown {
              from { height: 100%; }
              to { height: 0%; }
          }
      `;
        document.head.appendChild(style);
        // Add to constructor after other UI initialization
        this.inventoryManager = new InventoryManager(this, this.chat);
        this.inventoryManager.updateLoadoutDisplay();
        this.svgLoader = new SVGLoader();
        this.loadAssets();
        // Listen for map data from the server
        this.socket.on('mapData', (mapData) => {
            //console.log('Received map data:', mapData);
            this.world_map_data = mapData;
            this.graphics.setMap(mapData);
            this.renderMap(mapData);
        });
        this.socket.on('zoneUpdate', (zones) => {
            // ... existing code ...
        });
        // Handle viewport animation to mobs
        this.socket.on('animateViewportToMob', (data) => {
            this.startViewportAnimation(data.x, data.y);
        });
        // Load background image
        this.backgroundImage.src = IMAGE_ASSETS["background"];
        this.backgroundImage.onload = () => {
            console.log('Background image loaded successfully');
        };
        // Load wall texture
        this.wallTexture.src = IMAGE_ASSETS["wall"];
        this.wallTexture.onload = () => {
            console.log('Wall texture loaded successfully');
        };
        this.gameStartTime = Date.now();
        // In constructor, after this.socket = io(...), around line 572
        // this.socket = io(prompt("Enter the server URL eg https://localhost:3000: \n Join a public server: https://54.151.123.177:3000/") || "", {
        //     reconnection: true,
        //     reconnectionAttempts: Infinity,
        //     reconnectionDelay: 1000,
        //     reconnectionDelayMax: 5000,
        //     randomizationFactor: 0.5
        // });
        this.chat = new Chat(this.socket);
    }
    async initializeSprites() {
        const loadSprite = async (sprite, filename) => {
            try {
                sprite.crossOrigin = "anonymous";
                sprite.src = await this.getAssetUrl(filename);
                return new Promise((resolve, reject) => {
                    sprite.onload = () => resolve();
                    sprite.onerror = (e) => {
                        console.error(`Failed to load sprite: ${filename}`, e);
                        reject(e);
                    };
                });
            }
            catch (error) {
                console.error(`Error loading sprite ${filename}:`, error);
                // Don't throw error, just log it and continue
            }
        };
        try {
            await Promise.allSettled([
                loadSprite(this.playerSprite, 'player.png'),
                loadSprite(this.octopusSprite, 'octopus.png'),
                loadSprite(this.fishSprite, 'fish.png'),
                loadSprite(this.coralSprite, 'coral.png'),
                loadSprite(this.palmSprite, 'palm.png')
            ]);
        }
        catch (error) {
            console.error('Error loading sprites:', error);
            // Continue even if some sprites fail to load
        }
    }
    authenticate() {
        // Get credentials from AuthUI or localStorage
        const credentials = {
            username: localStorage.getItem('username') || 'player1',
            password: localStorage.getItem('password') || 'password123',
            playerName: this.nameInput?.value || 'Anonymous'
        };
        this.socket.emit('authenticate', credentials);
        this.socket.on('authenticated', (response) => {
            if (response.success) {
                console.log('Authentication successful');
                if (response.player) {
                    if (this.socket.id) {
                        // Update player data with saved progress
                        const player = this.players.get(this.socket.id);
                        if (player) {
                            Object.assign(player, response.player);
                        }
                    }
                }
            }
            else {
                console.error('Authentication failed:', response.error);
                alert('Authentication failed: ' + response.error);
                localStorage.removeItem('currentUser');
                window.location.reload();
            }
        });
    }
    setupEventListeners() {
        document.addEventListener('keydown', (event) => {
            if (this.chat && this.chat.isFocused) {
                if (event.key === 'Escape') {
                    this.chat.blur();
                }
                return;
            }
            // Prevent browser shortcuts for game keys only when chat is not focused
            const gameKeys = Object.values(this.controls);
            if (gameKeys.includes(event.key) || event.key.match(/^[1-9]$/)) {
                event.preventDefault();
            }
            if (event.key === this.controls.chat) {
                this.chat?.focus();
                return;
            }
            // Zoom controls
            if (event.key === this.controls.zoom_out) {
                this.zoomOut();
                return;
            }
            if (event.key === this.controls.zoom_in) {
                this.zoomIn();
                return;
            }
            if (event.key === this.controls.inventory) {
                this.inventoryManager.toggleInventory();
                return;
            }
            if (event.key === this.controls.crafting) {
                this.inventoryManager.toggleCrafting();
                return;
            }
            if (event.key === this.controls.toggle_mouse_controls) {
                this.useMouseControls = !this.useMouseControls;
                this.showFloatingText(this.canvas.width / 2, 50, `Controls: ${this.useMouseControls ? 'Mouse' : 'Keyboard'}`, '#FFFFFF', 20);
                return;
            }
            if (event.key === this.controls.toggle_hitboxes) {
                this.showHitboxes = !this.showHitboxes;
                this.graphics.showHitboxes = this.showHitboxes;
                this.showFloatingText(this.canvas.width / 2, 50, `Hitboxes: ${this.showHitboxes ? 'ON' : 'OFF'}`, '#FFFFFF', 20);
                return;
            }
            const key = event.key;
            const slotIndex = this.inventoryManager.getLoadoutKeyBindings().indexOf(key);
            if (slotIndex !== -1) {
                this.inventoryManager.useLoadoutItem(slotIndex);
                return;
            }
            this.keysPressed.add(event.key);
        });
        document.addEventListener('keyup', (event) => {
            this.keysPressed.delete(event.key);
            // Remove immediate velocity update - handled in game loop
        });
        // Add name input change listener
        this.nameInput?.addEventListener('change', () => {
            if (this.socket && this.nameInput) {
                this.socket.emit('updateName', this.nameInput.value);
            }
        });
        // Add drag and drop handlers for loadout
        const loadoutBar = document.getElementById('loadoutBar');
        if (loadoutBar) {
            loadoutBar.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
        }
    }
    zoomIn() {
        this.zoomLevel = Math.min(this.zoomLevel + this.ZOOM_STEP, this.MAX_ZOOM);
        this.showFloatingText(this.canvas.width / 2, 50, `Zoom: ${Math.round(this.zoomLevel * 100)}%`, '#FFFFFF', 20);
    }
    zoomOut() {
        this.zoomLevel = Math.max(this.zoomLevel - this.ZOOM_STEP, this.MIN_ZOOM);
        this.showFloatingText(this.canvas.width / 2, 50, `Zoom: ${Math.round(this.zoomLevel * 100)}%`, '#FFFFFF', 20);
    }
    updateCamera(player) {
        if (this.isAnimatingViewport) {
            this.updateViewportAnimation();
            return;
        }
        // Center camera on player with zoom
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        const targetX = player.x - scaledWidth / 2;
        const targetY = player.y - scaledHeight / 2;
        // Clamp camera to world bounds with proper dimensions
        this.cameraX = Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - scaledWidth, targetX));
        this.cameraY = Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - scaledHeight, targetY));
        this.graphics.setCamera(this.cameraX, this.cameraY, this.zoomLevel);
    }
    startViewportAnimation(mobX, mobY) {
        const localPlayer = this.getLocalPlayer();
        if (!localPlayer)
            return;
        // Save current player position
        this.savedPlayerPos = { x: localPlayer.x, y: localPlayer.y };
        // Set up animation to mob
        this.animationStartPos = { x: this.cameraX, y: this.cameraY };
        const scaledWidth = this.canvas.width / this.zoomLevel;
        const scaledHeight = this.canvas.height / this.zoomLevel;
        this.animationTargetPos = {
            x: Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - scaledWidth, mobX - scaledWidth / 2)),
            y: Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - scaledHeight, mobY - scaledHeight / 2))
        };
        this.isAnimatingViewport = true;
        this.animationPhase = 'to_mob';
        this.animationStartTime = Date.now();
    }
    updateViewportAnimation() {
        const currentTime = Date.now();
        const elapsed = currentTime - this.animationStartTime;
        if (this.animationPhase === 'to_mob') {
            // Animate to mob position
            const progress = Math.min(elapsed / this.animationDuration, 1);
            const easeProgress = this.easeInOutCubic(progress);
            this.cameraX = this.animationStartPos.x + (this.animationTargetPos.x - this.animationStartPos.x) * easeProgress;
            this.cameraY = this.animationStartPos.y + (this.animationTargetPos.y - this.animationStartPos.y) * easeProgress;
            if (progress >= 1) {
                // Switch to waiting phase
                this.animationPhase = 'at_mob';
                this.animationStartTime = currentTime;
            }
        }
        else if (this.animationPhase === 'at_mob') {
            // Wait at mob for 1 second
            if (elapsed >= this.animationDuration) {
                // Set up animation back to player
                this.animationStartPos = { x: this.cameraX, y: this.cameraY };
                const scaledWidth = this.canvas.width / this.zoomLevel;
                const scaledHeight = this.canvas.height / this.zoomLevel;
                this.animationTargetPos = {
                    x: Math.max(0, Math.min(ACTUAL_WORLD_WIDTH - scaledWidth, this.savedPlayerPos.x - scaledWidth / 2)),
                    y: Math.max(0, Math.min(ACTUAL_WORLD_HEIGHT - scaledHeight, this.savedPlayerPos.y - scaledHeight / 2))
                };
                this.animationPhase = 'to_player';
                this.animationStartTime = currentTime;
            }
        }
        else if (this.animationPhase === 'to_player') {
            // Animate back to player
            const progress = Math.min(elapsed / this.animationDuration, 1);
            const easeProgress = this.easeInOutCubic(progress);
            this.cameraX = this.animationStartPos.x + (this.animationTargetPos.x - this.animationStartPos.x) * easeProgress;
            this.cameraY = this.animationStartPos.y + (this.animationTargetPos.y - this.animationStartPos.y) * easeProgress;
            if (progress >= 1) {
                // Animation complete
                this.isAnimatingViewport = false;
                this.animationPhase = 'none';
            }
        }
        this.graphics.setCamera(this.cameraX, this.cameraY, this.zoomLevel);
    }
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    gameLoop() {
        this.update();
        this.graphics.render(this.players, this.enemies, this.items, this.socket?.id ?? '', this.petalExtension);
        requestAnimationFrame(() => this.gameLoop());
    }
    update() {
        // Interpolate all players' positions
        for (const player of this.players.values()) {
            if (player.targetX !== undefined && player.targetY !== undefined) {
                const lerpFactor = 0.1; // Adjust for smoother or more responsive movement
                player.x += (player.targetX - player.x) * lerpFactor;
                player.y += (player.targetY - player.y) * lerpFactor;
            }
        }
        // Update petal extension based on key presses
        this.updatePetalExtension();
        const player = this.players.get(this.socket?.id ?? '');
        if (player) {
            this.updatePlayerMovement(player, 1); // Assuming 60fps, so delta is roughly 1
            this.updateCamera(player);
            this.updatePlayerEye();
        }
    }
    updatePetalExtension() {
        const extensionSpeed = 0.05; // How fast petals extend/retract
        const maxExtension = 2.0; // Maximum extension multiplier
        const minExtension = 0.7; // Minimum extension multiplier
        if (this.keysPressed.has(' ')) {
            // Space key - extend petals
            this.petalExtension = Math.min(maxExtension, this.petalExtension + extensionSpeed);
        }
        else if (this.keysPressed.has('Shift')) {
            // Shift key - retract petals
            this.petalExtension = Math.max(minExtension, this.petalExtension - extensionSpeed);
        }
        else {
            // No keys pressed - return to normal
            const targetExtension = 1.0;
            if (this.petalExtension > targetExtension) {
                this.petalExtension = Math.max(targetExtension, this.petalExtension - extensionSpeed);
            }
            else if (this.petalExtension < targetExtension) {
                this.petalExtension = Math.min(targetExtension, this.petalExtension + extensionSpeed);
            }
        }
    }
    updatePlayerMovement(player, deltaTime) {
        const speed = 5 * (player.speed_boost ? 2 : 1);
        let dx = 0;
        let dy = 0;
        if (this.keysPressed.has(this.controls.move_up) || this.keysPressed.has('ArrowUp')) {
            dy -= 1;
        }
        if (this.keysPressed.has(this.controls.move_down) || this.keysPressed.has('ArrowDown')) {
            dy += 1;
        }
        if (this.keysPressed.has(this.controls.move_left) || this.keysPressed.has('ArrowLeft')) {
            dx -= 1;
        }
        if (this.keysPressed.has(this.controls.move_right) || this.keysPressed.has('ArrowRight')) {
            dx += 1;
        }
        // Only send input, don't update position locally
        this.socket.emit('playerInput', {
            keys: Array.from(this.keysPressed),
            petalExtension: this.petalExtension
        });
    }
    updatePlayerEye() {
        const player = this.players.get(this.socket?.id ?? '');
        if (player) {
            const dx = this.mouseX - player.x;
            const dy = this.mouseY - player.y;
            const angle = Math.atan2(dy, dx);
            const distance = Math.min(Math.sqrt(dx * dx + dy * dy), 10);
            this.playerEye = {
                x: Math.cos(angle) * distance,
                y: Math.sin(angle) * distance
            };
            if (player.eye) {
                player.eye.x = this.playerEye.x;
                player.eye.y = this.playerEye.y;
            }
        }
    }
    showFloatingText(x, y, text, color, fontSize) {
        this.graphics.showFloatingText(x, y, text, color, fontSize);
    }
    renderMap(mapData) {
        // Store the map data and render it
        this.world_map_data = mapData;
        this.graphics.drawMap(mapData);
    }
    async setupItemSprites() {
        this.itemSprites = {};
        const itemTypes = ['health_potion', 'speed_boost', 'shield'];
        try {
            await Promise.all(itemTypes.map(async (type) => {
                const sprite = new Image();
                sprite.crossOrigin = "anonymous";
                const url = await this.getAssetUrl(`${type}.png`);
                await new Promise((resolve, reject) => {
                    sprite.onload = () => {
                        this.itemSprites[type] = sprite;
                        resolve();
                    };
                    sprite.onerror = (error) => {
                        console.error(`Failed to load sprite for ${type}:`, error);
                        reject(error);
                    };
                    sprite.src = url;
                });
            }));
            console.log('All item sprites loaded successfully:', Object.keys(this.itemSprites));
            this.graphics.setupItemSprites(this.itemSprites);
        }
        catch (error) {
            console.error('Error loading item sprites:', error);
        }
    }
    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        // Update any viewport-dependent calculations here
        // For example, you might want to adjust the camera bounds
        // console.log('Canvas resized to:', this.canvas.width, 'x', this.canvas.height);
    }
    // Change from private to public
    cleanup() {
        // Stop the game loop immediately to prevent further drawing
        if (this.gameLoopId) {
            cancelAnimationFrame(this.gameLoopId);
            this.gameLoopId = null;
        }
        // Disconnect socket if it exists
        if (this.socket) {
            this.socket.disconnect();
        }
        // Clear all game data
        this.players.clear();
        this.enemies.clear();
        this.dots = [];
        this.obstacles = [];
        this.items = new Map();
        this.world_map_data = [];
        this.floatingTexts = [];
        this.decorations = [];
        this.sands = [];
        this.walls = [];
        // Define clear canvas function
        const clearCanvas = () => {
            // Clear the main canvas
            this.graphics.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            // Fill with white background
            this.graphics.ctx.fillStyle = 'white';
            this.graphics.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            // Explicitly clear the minimap area
            const minimapX = this.canvas.width - this.MINIMAP_WIDTH - this.MINIMAP_PADDING;
            const minimapY = this.MINIMAP_PADDING;
            this.graphics.ctx.clearRect(minimapX - 5, minimapY - 5, this.MINIMAP_WIDTH + 10, this.MINIMAP_HEIGHT + 10);
            this.graphics.ctx.fillStyle = 'white';
            this.graphics.ctx.fillRect(minimapX - 5, minimapY - 5, this.MINIMAP_WIDTH + 10, this.MINIMAP_HEIGHT + 10);
        };
        // Clear multiple times to ensure everything is gone
        clearCanvas();
        requestAnimationFrame(clearCanvas);
        setTimeout(clearCanvas, 50);
        // Reset game state
        this.isInventoryOpen = false;
        this.isCraftingOpen = false;
        this.speedBoostActive = false;
        this.shieldActive = false;
        this.isPlayerDead = false;
        this.useMouseControls = false;
        // Hide all game UI elements
        if (this.inventoryPanel)
            this.inventoryPanel.style.display = 'none';
        if (this.craftingPanel)
            this.craftingPanel.style.display = 'none';
        if (this.chatContainer)
            this.chatContainer.style.display = 'none';
        if (this.saveIndicator)
            this.saveIndicator.style.display = 'none';
        // Clear loadout bar
        const loadoutBar = document.getElementById('loadoutBar');
        if (loadoutBar) {
            loadoutBar.style.display = 'none';
            // Clear all loadout slots
            const slots = loadoutBar.querySelectorAll('.loadout-slot');
            slots.forEach(slot => {
                slot.innerHTML = '';
            });
        }
        // Reset camera position
        this.cameraX = 0;
        this.cameraY = 0;
        // Clear any remaining timeouts or intervals
        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
            this.saveIndicatorTimeout = null;
        }
        // Remove any event listeners
        this.keysPressed.clear();
        // Set canvas background to white
        this.canvas.style.backgroundColor = 'white';
        // Stop drawing the game loop
        this.gameLoopId = null;
        // Clean up inventory manager
        this.inventoryManager.cleanup();
    }
    hideExitButton() {
        if (this.exitButtonContainer) {
            this.exitButtonContainer.style.display = 'none';
        }
    }
    handleExit() {
        // Clean up game state
        this.cleanup();
        // Show title screen elements with proper styling
        if (this.titleScreen) {
            this.titleScreen.style.display = 'flex';
            this.titleScreen.style.opacity = '1';
            this.titleScreen.style.zIndex = '1000';
            this.titleScreen.style.pointerEvents = 'auto';
        }
        if (this.nameInput) {
            this.nameInput.style.display = 'block';
            this.nameInput.style.opacity = '1';
            this.nameInput.value = ''; // Clear the input
        }
        // Hide exit button
        this.hideExitButton();
        // Show game menu with proper styling
        const gameMenu = document.getElementById('gameMenu');
        if (gameMenu) {
            gameMenu.style.display = 'flex';
            gameMenu.style.opacity = '1';
            gameMenu.style.zIndex = '3000';
            gameMenu.style.pointerEvents = 'auto';
        }
        // Reset canvas state
        this.canvas.style.zIndex = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.backgroundColor = 'white';
        // Clear any remaining timeouts or intervals
        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
            this.saveIndicatorTimeout = null;
        }
        // Remove any event listeners
        this.keysPressed.clear();
        // Force multiple clear attempts to ensure everything is gone
        for (let i = 0; i < 3; i++) {
            requestAnimationFrame(() => {
                this.graphics.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.graphics.ctx.fillStyle = 'white';
                this.graphics.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            });
        }
    }
    applyHueRotation(ctx, imageData) {
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            // Skip fully transparent pixels
            if (data[i + 3] === 0)
                continue;
            // Convert RGB to HSL
            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;
            if (max === min) {
                h = s = 0; // achromatic
            }
            else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r:
                        h = (g - b) / d + (g < b ? 6 : 0);
                        break;
                    case g:
                        h = (b - r) / d + 2;
                        break;
                    case b:
                        h = (r - g) / d + 4;
                        break;
                    default: h = 0;
                }
                h /= 6;
            }
            // Only adjust hue if the pixel has some saturation
            if (s > 0.1) { // Threshold for considering a pixel colored
                h = (h + this.playerHue / 360) % 1;
                // Convert back to RGB
                if (s === 0) {
                    data[i] = data[i + 1] = data[i + 2] = l * 255;
                }
                else {
                    const hue2rgb = (p, q, t) => {
                        if (t < 0)
                            t += 1;
                        if (t > 1)
                            t -= 1;
                        if (t < 1 / 6)
                            return p + (q - p) * 6 * t;
                        if (t < 1 / 2)
                            return q;
                        if (t < 2 / 3)
                            return p + (q - p) * (2 / 3 - t) * 6;
                        return p;
                    };
                    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    const p = 2 * l - q;
                    data[i] = hue2rgb(p, q, h + 1 / 3) * 255;
                    data[i + 1] = hue2rgb(p, q, h) * 255;
                    data[i + 2] = hue2rgb(p, q, h - 1 / 3) * 255;
                }
            }
        }
    }
    updateColorPreview() {
        if (!this.playerSprite.complete)
            return;
        const ctx = this.colorPreviewCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.colorPreviewCanvas.width, this.colorPreviewCanvas.height);
        // Draw the sprite centered in the preview
        const scale = Math.min(this.colorPreviewCanvas.width / this.playerSprite.width, this.colorPreviewCanvas.height / this.playerSprite.height);
        const x = (this.colorPreviewCanvas.width - this.playerSprite.width * scale) / 2;
        const y = (this.colorPreviewCanvas.height - this.playerSprite.height * scale) / 2;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.drawImage(this.playerSprite, 0, 0);
        const imageData = ctx.getImageData(0, 0, this.colorPreviewCanvas.width, this.colorPreviewCanvas.height);
        this.applyHueRotation(ctx, imageData);
        ctx.putImageData(imageData, 0, 0);
        ctx.restore();
    }
    // Add this helper method to handle asset URLs
    async getAssetUrl(filename) {
        // Remove the file extension to get the asset key
        const assetKey = filename.replace('.png', '');
        // If running from file:// protocol, use base64 data
        if (window.location.protocol === 'file:') {
            // Get the base64 data from our assets
            const base64Data = IMAGE_ASSETS[assetKey];
            if (base64Data) {
                return base64Data;
            }
            console.error(`No base64 data found for asset: ${filename}`);
        }
        // Otherwise use normal URL
        return `./assets/${filename}`;
    }
    async loadAssets() {
        try {
            // Create a simple wall SVG programmatically
            const wallSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            wallSVG.setAttribute("width", "100");
            wallSVG.setAttribute("height", "100");
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("width", "100");
            rect.setAttribute("height", "100");
            rect.setAttribute("fill", "#666");
            wallSVG.appendChild(rect);
            // Store the wall SVG
            this.walls = Array(100).fill(null).map(() => ({
                x: Math.random() * this.WORLD_WIDTH,
                y: Math.random() * this.WORLD_HEIGHT,
                element: wallSVG.cloneNode(true)
            }));
            console.log('Successfully initialized walls');
        }
        catch (error) {
            console.error('Failed to load game assets:', error);
            // Create empty walls array if loading fails
            this.walls = [];
        }
    }
    getLocalPlayer() {
        return this.players.get(this.socket?.id || '');
    }
    getSocket() {
        return this.socket;
    }
    loadControls() {
        const savedControls = localStorage.getItem('controls');
        if (savedControls) {
            this.controls = { ...this.getDefaultControls(), ...JSON.parse(savedControls) };
        }
        else {
            this.controls = this.getDefaultControls();
        }
    }
    getDefaultControls() {
        return {
            move_up: 'w',
            move_down: 's',
            move_left: 'a',
            move_right: 'd',
            inventory: 'i',
            crafting: 'r',
            toggle_mouse_controls: 'c',
            toggle_hitboxes: 'h',
            zoom_in: '=',
            zoom_out: '-',
            chat: 'Enter',
            extend_petals: ' ',
            retract_petals: 'Shift',
        };
    }
    savePlayerProgress() { }
    hideTitleScreen() { }
    showDeathScreen() {
        document.getElementById('deathScreen')?.classList.remove('hidden');
    }
    hideDeathScreen() {
        document.getElementById('deathScreen')?.classList.add('hidden');
    }
    showTitleScreen() {
        document.getElementById('titleScreen')?.classList.remove('hidden');
    }
    showSaveIndicator() {
        this.graphics.showFloatingText(this.canvas.width / 2, 0, 'Progress Saved', 'white', 20);
    }
    // UI methods for cross-server transfer
    showTransferMessage(message) {
        // Create or update transfer message UI
        let transferDiv = document.getElementById('transfer-message');
        if (!transferDiv) {
            transferDiv = document.createElement('div');
            transferDiv.id = 'transfer-message';
            transferDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 20px;
                border-radius: 10px;
                font-size: 18px;
                font-family: Arial, sans-serif;
                z-index: 1000;
                text-align: center;
                border: 2px solid #00b3ff;
            `;
            document.body.appendChild(transferDiv);
        }
        transferDiv.textContent = message;
    }
    hideTransferMessage() {
        const transferDiv = document.getElementById('transfer-message');
        if (transferDiv) {
            transferDiv.remove();
        }
    }
    addTeleportEffect(x, y) {
        // Add visual teleport effect at the specified coordinates
        // This would typically involve particle effects or other visual feedback
        console.log(`[CLIENT] Teleport effect at (${x}, ${y})`);
        // Simple flash effect (you could expand this with more sophisticated graphics)
        const canvas = document.querySelector('canvas');
        if (canvas && this.graphics) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Save current state
                ctx.save();
                // Draw teleport flash
                ctx.globalAlpha = 0.7;
                ctx.fillStyle = '#00b3ff';
                ctx.beginPath();
                ctx.arc(x - this.cameraX, y - this.cameraY, 50, 0, Math.PI * 2);
                ctx.fill();
                // Restore state
                ctx.restore();
                // Fade out effect
                setTimeout(() => {
                    if (ctx) {
                        ctx.save();
                        ctx.globalAlpha = 0.3;
                        ctx.fillStyle = '#00b3ff';
                        ctx.beginPath();
                        ctx.arc(x - this.cameraX, y - this.cameraY, 30, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                    }
                }, 100);
            }
        }
    }
    // UI methods for teleporter countdown
    showTeleporterUI(teleportTo, timeRequired) {
        // Create or update teleporter UI
        let teleporterDiv = document.getElementById('teleporter-ui');
        if (!teleporterDiv) {
            teleporterDiv = document.createElement('div');
            teleporterDiv.id = 'teleporter-ui';
            teleporterDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 30, 60, 0.95);
                color: white;
                padding: 25px;
                border-radius: 15px;
                font-size: 18px;
                font-family: Arial, sans-serif;
                z-index: 1000;
                text-align: center;
                border: 3px solid #2196F3;
                box-shadow: 0 0 20px rgba(33, 150, 243, 0.5);
                min-width: 300px;
            `;
            document.body.appendChild(teleporterDiv);
        }
        // Create countdown display
        const startTime = Date.now();
        const updateCountdown = () => {
            if (!document.getElementById('teleporter-ui'))
                return; // UI was removed
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, timeRequired - elapsed);
            const progress = Math.min(1, elapsed / timeRequired);
            let message = '<div style="margin-bottom: 15px; font-weight: bold; color: #2196F3;">🌀 TELEPORTER CHARGING</div>';
            if (teleportTo.serverPort) {
                message += `<div style="margin-bottom: 10px;">Destination: <span style="color: #FFD700;">Server ${teleportTo.serverPort}</span></div>`;
            }
            else {
                message += '<div style="margin-bottom: 10px;">Destination: <span style="color: #4CAF50;">Same Server</span></div>';
            }
            message += `<div style="margin-bottom: 10px;">Coordinates: (${teleportTo.x}, ${teleportTo.y})</div>`;
            if (remaining > 0) {
                message += `<div style="margin-bottom: 15px; font-size: 20px; color: #FFC107;">${(remaining / 1000).toFixed(1)}s</div>`;
                // Progress bar
                message += `
                    <div style="width: 100%; background: rgba(255,255,255,0.2); border-radius: 10px; height: 8px; margin-bottom: 10px;">
                        <div style="width: ${progress * 100}%; background: linear-gradient(90deg, #2196F3, #00BCD4); height: 100%; border-radius: 10px; transition: width 0.1s;"></div>
                    </div>
                `;
                message += '<div style="font-size: 14px; color: #AAA;">Stay in teleporter to continue...</div>';
            }
            else {
                message += '<div style="font-size: 20px; color: #4CAF50;">✨ TELEPORTING! ✨</div>';
            }
            teleporterDiv.innerHTML = message;
            if (remaining > 0) {
                setTimeout(updateCountdown, 100); // Update every 100ms for smooth countdown
            }
        };
        updateCountdown();
    }
    hideTeleporterUI() {
        const teleporterDiv = document.getElementById('teleporter-ui');
        if (teleporterDiv) {
            teleporterDiv.remove();
        }
    }
}

;// ./src/auth_ui.ts
class AuthUI {
    constructor() {
        // Get DOM elements - these should now exist from TitleScreen
        this.authContainer = document.getElementById('authContainer');
        this.loginForm = document.getElementById('loginForm');
        this.registerForm = document.getElementById('registerForm');
        // Login elements
        this.loginButton = document.getElementById('loginButton');
        this.loginUsername = document.getElementById('loginUsername');
        this.loginPassword = document.getElementById('loginPassword');
        // Register elements
        this.registerButton = document.getElementById('registerButton');
        this.registerOfflineButton = document.getElementById('registerOfflineButton');
        this.registerUsername = document.getElementById('registerUsername');
        this.registerPassword = document.getElementById('registerPassword');
        this.registerConfirmPassword = document.getElementById('registerConfirmPassword');
        this.serverIPInput = document.getElementById('serverIP-connect');
        // Set default server URL to current origin
        const currentOrigin = window.location.origin;
        this.serverIPInput.value = currentOrigin;
        this.serverUrl = this.serverIPInput.value;
        // Form switch elements
        this.showRegisterLink = document.getElementById('showRegister');
        this.showLoginLink = document.getElementById('showLogin');
        // Bind event listeners
        this.loginButton.addEventListener('click', () => this.handleLogin());
        this.registerButton.addEventListener('click', () => this.handleRegister());
        this.registerOfflineButton.addEventListener('click', () => this.handleOfflineRegister());
        this.showRegisterLink.addEventListener('click', () => this.toggleForms());
        this.showLoginLink.addEventListener('click', () => this.toggleForms());
        // Add server IP change listener
        this.serverIPInput.addEventListener('change', () => {
            this.serverUrl = this.serverIPInput.value;
            // Store the server URL for future use
            localStorage.setItem('serverUrl', this.serverUrl);
        });
        // Load saved server URL if exists
        const savedServerUrl = localStorage.getItem('serverUrl');
        if (savedServerUrl) {
            this.serverUrl = savedServerUrl;
            this.serverIPInput.value = savedServerUrl;
        }
        // Check for stored credentials
        this.checkStoredCredentials();
    }
    toggleForms() {
        this.loginForm.classList.toggle('hidden');
        this.registerForm.classList.toggle('hidden');
        // Update server URL when switching to login
        if (!this.loginForm.classList.contains('hidden')) {
            this.serverUrl = this.serverIPInput.value;
        }
    }
    async handleLogin() {
        const username = this.loginUsername.value;
        const password = this.loginPassword.value;
        // Use the server URL from the input field even during login
        this.serverUrl = this.serverIPInput.value;
        const serverUrl = this.serverIPInput.value || this.serverUrl;
        try {
            // Try server authentication first
            const response = await fetch(`${serverUrl}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });
            if (response.ok) {
                // Store credentials and server URL locally
                localStorage.setItem('username', username);
                localStorage.setItem('password', password);
                localStorage.setItem('currentUser', username);
                localStorage.setItem('serverUrl', serverUrl);
                sessionStorage.removeItem('isOffline'); // Clear any offline status
                this.hideAuthForm();
            }
            else {
                // Check offline credentials in sessionStorage
                const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
                if (offlineCredentials.username === username &&
                    offlineCredentials.password === password &&
                    offlineCredentials.isOffline) {
                    sessionStorage.setItem('currentUser', username);
                    sessionStorage.setItem('isOffline', 'true');
                    this.hideAuthForm();
                }
                else {
                    alert('Invalid username or password');
                }
            }
        }
        catch (error) {
            console.error('Login error:', error);
            // Check offline credentials on server error
            const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
            if (offlineCredentials.username === username &&
                offlineCredentials.password === password &&
                offlineCredentials.isOffline) {
                sessionStorage.setItem('currentUser', username);
                sessionStorage.setItem('isOffline', 'true');
                this.hideAuthForm();
            }
            else {
                alert('Invalid username or password');
            }
        }
    }
    async handleRegister() {
        const username = this.registerUsername.value;
        const password = this.registerPassword.value;
        const confirmPassword = this.registerConfirmPassword.value;
        const serverIPSingle = document.getElementById('serverIP-single');
        const serverUrl = serverIPSingle.value;
        if (!serverUrl) {
            alert('Please enter a server IP address');
            return;
        }
        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }
        try {
            // Try server registration first
            const response = await fetch(`${serverUrl}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });
            if (response.ok) {
                // Store credentials locally as backup
                const storedCredentials = this.getStoredCredentials();
                storedCredentials.push({ username, password });
                localStorage.setItem('credentials', JSON.stringify(storedCredentials));
                localStorage.setItem('serverUrl', serverUrl);
                // Switch to login form
                this.toggleForms();
                alert('Registration successful! Please login.');
            }
            else {
                const errorData = await response.json();
                alert(errorData.message || 'Registration failed');
            }
        }
        catch (error) {
            console.error('Registration error:', error);
            alert('Could not connect to server. Please check the server IP and try again.');
        }
    }
    async handleOfflineRegister() {
        const username = this.registerUsername.value;
        const password = this.registerPassword.value;
        const confirmPassword = this.registerConfirmPassword.value;
        if (!username || !password) {
            alert('Username and password are required');
            return;
        }
        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }
        // Check if username exists in temporary storage
        const storedCredentials = this.getStoredCredentials();
        if (storedCredentials.some(cred => cred.username === username)) {
            alert('Username already exists locally');
            return;
        }
        // Store credentials in sessionStorage (temporary)
        const offlineCredentials = {
            username,
            password,
            isOffline: true
        };
        // Store in sessionStorage (temporary) instead of localStorage
        sessionStorage.setItem('offlineCredentials', JSON.stringify(offlineCredentials));
        sessionStorage.setItem('currentUser', username);
        sessionStorage.setItem('isOffline', 'true');
        // Switch to login form
        this.toggleForms();
        alert('Offline registration successful! Note: This account is temporary and will be lost when you close the browser.');
    }
    getStoredCredentials() {
        const stored = localStorage.getItem('credentials');
        return stored ? JSON.parse(stored) : [];
    }
    checkStoredCredentials() {
        // Check if user is logged in offline
        const isOffline = sessionStorage.getItem('isOffline');
        if (isOffline) {
            const currentUser = sessionStorage.getItem('currentUser');
            const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
            if (currentUser && offlineCredentials.username === currentUser) {
                this.hideAuthForm();
                return;
            }
        }
        // Check online credentials
        const currentUser = localStorage.getItem('currentUser');
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        if (currentUser && username && password) {
            this.verifyStoredCredentials(username, password).then(valid => {
                if (valid) {
                    this.hideAuthForm();
                }
                else {
                    this.logout();
                }
            });
        }
    }
    async verifyStoredCredentials(username, password) {
        try {
            const response = await fetch(`${this.serverUrl}/auth/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });
            return response.ok;
        }
        catch (error) {
            console.error('Verification error:', error);
            return false;
        }
    }
    hideAuthForm() {
        this.authContainer.classList.add('hidden');
    }
    showAuthForm() {
        this.authContainer.classList.remove('hidden');
    }
    logout() {
        // Clear both localStorage and sessionStorage
        localStorage.removeItem('currentUser');
        localStorage.removeItem('username');
        localStorage.removeItem('password');
        sessionStorage.removeItem('currentUser');
        sessionStorage.removeItem('offlineCredentials');
        sessionStorage.removeItem('isOffline');
        // Attempt server logout only if not offline
        if (!sessionStorage.getItem('isOffline')) {
            fetch(`${this.serverUrl}/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            }).catch(error => {
                console.error('Logout error:', error);
            });
        }
        this.showAuthForm();
    }
}

;// ./src/title_screen.ts
/**
 * Title Screen Menu Management
 * Handles all menu-related DOM elements and interactions
 */
class TitleScreen {
    constructor() {
        this.initializeElements();
        this.setupEventListeners();
    }
    initializeElements() {
        // Create authentication container
        this.authContainer = this.createElement('div', 'auth-container');
        this.authContainer.id = 'authContainer';
        this.authContainer.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 2000;
            background: rgba(0, 0, 0, 0.8);
            padding: 20px;
            border-radius: 10px;
            color: white;
            pointer-events: auto;
        `;
        document.body.style.cssText = `
            background: rgb(0, 216, 133);
        `;
        this.loadingScreen = document.getElementById('loadingScreen');
        if (this.loadingScreen) {
            this.loadingScreen.style.cssText = `
                display: none;
            `;
        }
        // Create login form
        this.loginForm = this.createElement('div', 'auth-form');
        this.loginForm.id = 'loginForm';
        this.loginForm.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 15px;
            min-width: 300px;
        `;
        this.loginForm.innerHTML = `
            <h2>Login</h2>
            <input type="text" id="loginUsername" placeholder="Username">
            <input type="password" id="loginPassword" placeholder="Password">
            <div class="advanced-settings">
                <button type="button" id="advancedSettingsToggle" class="advanced-toggle">Advanced Settings ▼</button>
                <div id="advancedSettings" class="advanced-settings-content hidden">
                    <div class="server-input">
                        <label for="serverIP-connect">Server IP:</label>
                        <input type="text" id="serverIP-connect" placeholder="Server IP">
                    </div>
                </div>
            </div>
            <button id="loginButton">Login</button>
            <p class="form-switch" id="showRegister">Need an account? Register</p>
        `;
        // Create register form
        this.registerForm = this.createElement('div', 'auth-form hidden');
        this.registerForm.id = 'registerForm';
        this.registerForm.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 15px;
            min-width: 300px;
        `;
        this.registerForm.innerHTML = `
            <h2>Register</h2>
            <br/>
            <h3>Do not use your real name or any personal information as your username.</h3>
            <input type="text" id="registerUsername" placeholder="Username">
            <input type="password" id="registerPassword" placeholder="Password">
            <input type="password" id="registerConfirmPassword" placeholder="Confirm Password">
            <div class="advanced-settings">
                <button type="button" id="advancedSettingsToggleRegister" class="advanced-toggle">Advanced Settings ▼</button>
                <div id="advancedSettingsRegister" class="advanced-settings-content hidden">
                    <div class="server-input">
                        <label for="serverIP-single">Server IP:</label>
                        <input type="text" id="serverIP-single" placeholder="Server IP">
                    </div>
                </div>
            </div>
            <button id="registerButton">Register</button>
            <button id="registerOfflineButton">Register Offline</button>
            <p class="form-switch" id="showLogin">Already have an account? Login</p>
        `;
        // Create game menu
        this.gameMenu = this.createElement('div', '');
        this.gameMenu.id = 'gameMenu';
        this.gameMenu.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 3000;
            text-align: center;
            display: flex;
            gap: 10px;
            padding: 15px;
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.7);
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
        `;
        this.gameMenu.innerHTML = `
            <button id="multiPlayerButton" class="buttons">Start Game</button>
            <button id="settingsButton" class="buttons">Settings</button>
        `;
        // Create center text
        this.centerText = this.createElement('div', 'center_text');
        this.centerText.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 1000;
            text-align: center;
            color: white;
            padding: 20px;
            border-radius: 10px;
            background: transparent;
            box-shadow: none;
        `;
        this.centerText.innerHTML = `
            <p class="title">florr.io clone</p>
            <p class="instructions">Use arrow keys to move. Touch enemies to attack.</p>
            <input type="text" id="nameInput" class="name-input" placeholder="This flower is called...">
            <div class="color-picker">
                <label for="hueSlider">Player Color:</label>
                <input type="range" id="hueSlider" min="0" max="360" value="0" class="hue-slider">
                <div id="colorPreview" class="color-preview"></div>
                <button id="updateColorButton" class="color-update-btn">Update Color</button>
            </div>
            <div class="controls">
                <p>Controls:</p>
                <br/>
                <p>Press I to open the inventory.</p>
                <br/>
                <p>Press number keys 1-9 to use items.</p>
                <br/>
                <p>Press C to switch between mouse and keyboard controls</p>
                <br/>
                <p>Press R to craft items</p>
            </div>
        `;
        this.settingsMenu = this.createElement('div', 'settings-menu hidden');
        this.settingsMenu.id = 'settingsMenu';
        this.settingsMenu.innerHTML = `
            <div class="settings-menu-content">
                <div class="settings-menu-header">
                    <h2>Settings</h2>
                    <button id="closeSettingsButton">&times;</button>
                </div>
                <div class="settings-menu-tabs">
                    <button class="tab-button active" data-tab="controls">Controls</button>
                    <button class="tab-button" data-tab="graphics">Graphics</button>
                    <button class="tab-button" data-tab="advanced">Advanced</button>
                </div>
                <div class="settings-menu-body">
                    <div id="controls-tab" class="tab-content active">
                        <h3>Controls</h3>
                        <div class="controls-grid">
                            <!-- Controls will be dynamically added here -->
                        </div>
                        <button id="saveControlsButton">Save Controls</button>
                        <button id="resetControlsButton">Reset to Default</button>
                    </div>
                    <div id="graphics-tab" class="tab-content">
                        <h3>Graphics</h3>
                        <label>
                            <input type="checkbox" id="showHitboxesCheckbox">
                            Show Hitboxes
                        </label>
                    </div>
                    <div id="advanced-tab" class="tab-content">
                        <h3>Advanced Settings</h3>
                        <div class="server-input">
                            <label for="serverIP-settings">Server IP:</label>
                            <input type="text" id="serverIP-settings" placeholder="Server IP">
                        </div>
                    </div>
                </div>
            </div>
        `;
        // Create exit button container
        this.exitButtonContainer = this.createElement('div', '');
        this.exitButtonContainer.id = 'exitButtonContainer';
        this.exitButtonContainer.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 3000;
            display: none;
        `;
        this.exitButtonContainer.innerHTML = `
            <img id="exitButton" src="./assets/exit.png" style="width: 32px; height: 32px; cursor: pointer; background: rgba(0, 0, 0, 0.5); padding: 5px; border-radius: 5px;" alt="Exit">
        `;
        // Create death screen
        this.deathScreen = this.createElement('div', 'hidden');
        this.deathScreen.id = 'deathScreen';
        this.deathScreen.innerHTML = `<p>You died!</p>`;
        // Create loading screen
        this.loadingScreen = this.createElement('div', 'hidden');
        this.loadingScreen.id = 'loadingScreen';
        this.loadingScreen.innerHTML = `<p>Loading...</p>`;
        // Create land and axolotl containers
        this.landContainer = this.createElement('div', '');
        this.landContainer.id = 'land-container';
        this.axolotlContainer = this.createElement('div', '');
        this.axolotlContainer.id = 'axolotl-container';
    }
    createElement(tagName, className) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        return element;
    }
    setupEventListeners() {
        // Exit button event listener
        const exitButton = this.exitButtonContainer.querySelector('#exitButton');
        if (exitButton) {
            exitButton.addEventListener('click', () => {
                window.location.reload();
            });
        }
        // Settings menu event listeners
        const settingsButton = this.gameMenu.querySelector('#settingsButton');
        const closeSettingsButton = this.settingsMenu.querySelector('#closeSettingsButton');
        if (settingsButton) {
            settingsButton.addEventListener('click', () => {
                this.settingsMenu.classList.remove('hidden');
            });
        }
        if (closeSettingsButton) {
            closeSettingsButton.addEventListener('click', () => {
                this.settingsMenu.classList.add('hidden');
            });
        }
        this.settingsMenu.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                const tab = button.getAttribute('data-tab');
                this.settingsMenu.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                this.settingsMenu.querySelectorAll('.tab-content').forEach(content => {
                    if (content.id === `${tab}-tab`) {
                        content.classList.add('active');
                    }
                    else {
                        content.classList.remove('active');
                    }
                });
            });
        });
        // Controls settings
        this.populateControlsTab();
        const saveControlsButton = this.settingsMenu.querySelector('#saveControlsButton');
        if (saveControlsButton) {
            saveControlsButton.addEventListener('click', () => this.saveControls());
        }
        const resetControlsButton = this.settingsMenu.querySelector('#resetControlsButton');
        if (resetControlsButton) {
            resetControlsButton.addEventListener('click', () => this.resetControls());
        }
        // Settings change listeners
        const showHitboxesCheckbox = this.settingsMenu.querySelector('#showHitboxesCheckbox');
        if (showHitboxesCheckbox) {
            showHitboxesCheckbox.addEventListener('change', () => {
                localStorage.setItem('showHitboxes', showHitboxesCheckbox.checked.toString());
            });
        }
        const serverIPInput = this.settingsMenu.querySelector('#serverIP-settings');
        if (serverIPInput) {
            serverIPInput.addEventListener('input', () => {
                localStorage.setItem('serverIP', serverIPInput.value);
            });
            serverIPInput.value = localStorage.getItem('serverIP') || window.location.origin;
        }
        // Form switching
        const showRegister = this.loginForm.querySelector('#showRegister');
        const showLogin = this.registerForm.querySelector('#showLogin');
        if (showRegister) {
            showRegister.addEventListener('click', () => {
                this.showRegisterForm();
            });
        }
        if (showLogin) {
            showLogin.addEventListener('click', () => {
                this.showLoginForm();
            });
        }
    }
    appendToBody() {
        document.body.appendChild(this.authContainer);
        this.authContainer.appendChild(this.loginForm);
        this.authContainer.appendChild(this.registerForm);
        document.body.appendChild(this.gameMenu);
        document.body.appendChild(this.centerText);
        document.body.appendChild(this.exitButtonContainer);
        document.body.appendChild(this.deathScreen);
        document.body.appendChild(this.loadingScreen);
        document.body.appendChild(this.landContainer);
        document.body.appendChild(this.axolotlContainer);
        document.body.appendChild(this.settingsMenu);
        // Add CSS for advanced settings
        this.addAdvancedSettingsStyles();
        // Debug: Check if forms are in DOM
        console.log('Login form in DOM:', document.getElementById('loginForm'));
        console.log('Register form in DOM:', document.getElementById('registerForm'));
        console.log('Advanced settings toggle in DOM:', document.getElementById('advancedSettingsToggle'));
        console.log('Advanced settings toggle register in DOM:', document.getElementById('advancedSettingsToggleRegister'));
        console.log('Login form innerHTML:', this.loginForm.innerHTML);
        // Setup advanced settings toggle functionality
        this.setupAdvancedSettingsToggle();
        this.loadSettings();
    }
    populateControlsTab() {
        const controlsGrid = this.settingsMenu.querySelector('.controls-grid');
        if (!controlsGrid)
            return;
        const controls = this.getControls();
        controlsGrid.innerHTML = '';
        for (const action in controls) {
            const controlRow = document.createElement('div');
            controlRow.className = 'control-row';
            controlRow.innerHTML = `
                <label>${action.replace(/_/g, ' ')}</label>
                <input type="text" class="control-input" data-action="${action}" value="${controls[action]}">
            `;
            controlsGrid.appendChild(controlRow);
        }
        controlsGrid.querySelectorAll('.control-input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                e.preventDefault();
                input.value = e.key;
            });
        });
    }
    getControls() {
        const savedControls = localStorage.getItem('controls');
        if (savedControls) {
            return { ...this.getDefaultControls(), ...JSON.parse(savedControls) };
        }
        return this.getDefaultControls();
    }
    getDefaultControls() {
        return {
            move_up: 'w',
            move_down: 's',
            move_left: 'a',
            move_right: 'd',
            inventory: 'i',
            crafting: 'r',
            toggle_mouse_controls: 'c',
            toggle_hitboxes: 'h',
            zoom_in: '=',
            zoom_out: '-',
            chat: 'Enter',
            extend_petals: ' ',
            retract_petals: 'Shift',
        };
    }
    saveControls() {
        const controls = {};
        this.settingsMenu.querySelectorAll('.control-input').forEach(input => {
            const action = input.getAttribute('data-action');
            if (action) {
                controls[action] = input.value;
            }
        });
        localStorage.setItem('controls', JSON.stringify(controls));
        alert('Controls saved!');
    }
    resetControls() {
        localStorage.removeItem('controls');
        this.populateControlsTab();
        alert('Controls have been reset to default.');
    }
    loadSettings() {
        const showHitboxes = localStorage.getItem('showHitboxes') === 'true';
        const showHitboxesCheckbox = this.settingsMenu.querySelector('#showHitboxesCheckbox');
        if (showHitboxesCheckbox) {
            showHitboxesCheckbox.checked = showHitboxes;
        }
        const serverIP = localStorage.getItem('serverIP') || window.location.origin;
        const serverIPInput = this.settingsMenu.querySelector('#serverIP-settings');
        if (serverIPInput) {
            serverIPInput.value = serverIP;
        }
    }
    addAdvancedSettingsStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .auth-form .advanced-settings {
                margin: 10px 0 !important;
            }
            
            .auth-form .advanced-toggle {
                background: rgba(255, 0, 0, 0.8) !important;
                border: 2px solid yellow !important;
                color: white !important;
                padding: 8px 12px !important;
                border-radius: 5px !important;
                cursor: pointer !important;
                font-size: 14px !important;
                transition: all 0.3s ease !important;
                width: 100% !important;
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            
            .auth-form .advanced-toggle:hover {
                background: rgba(255, 255, 255, 0.2) !important;
                border-color: rgba(255, 255, 255, 0.5) !important;
            }
            
            .auth-form .advanced-settings-content {
                margin-top: 10px !important;
                padding: 10px !important;
                background: rgba(0, 0, 0, 0.3) !important;
                border-radius: 5px !important;
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
            }
            
            .auth-form .advanced-settings-content.hidden {
                display: none !important;
            }
            
            .auth-form .server-input {
                display: flex !important;
                flex-direction: column !important;
                gap: 5px !important;
            }
            
            .auth-form .server-input label {
                color: white !important;
                font-size: 14px !important;
                font-weight: bold !important;
            }
            
            .auth-form .server-input input {
                padding: 8px !important;
                border: 1px solid rgba(255, 255, 255, 0.3) !important;
                border-radius: 4px !important;
                background: rgba(255, 255, 255, 0.1) !important;
                color: white !important;
                font-size: 14px !important;
            }
            
            .auth-form .server-input input::placeholder {
                color: rgba(255, 255, 255, 0.6) !important;
            }
            
            .auth-form .server-input input:focus {
                outline: none !important;
                border-color: rgba(255, 255, 255, 0.6) !important;
                background: rgba(255, 255, 255, 0.15) !important;
            }
        `;
        document.head.appendChild(style);
    }
    setupAdvancedSettingsToggle() {
        // Get current origin for default values
        const currentOrigin = window.location.origin;
        console.log('Setting up advanced settings toggle...');
        console.log('Current origin:', currentOrigin);
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            console.log('Inside setTimeout - checking for elements...');
            // Setup login form advanced settings
            const loginToggle = document.getElementById('advancedSettingsToggle');
            const loginAdvancedSettings = document.getElementById('advancedSettings');
            const loginServerInput = document.getElementById('serverIP-connect');
            console.log('Login elements found:', { loginToggle, loginAdvancedSettings, loginServerInput });
            console.log('Login toggle element:', loginToggle);
            console.log('Login toggle innerHTML:', loginToggle?.innerHTML);
            console.log('Login toggle style:', loginToggle?.style.cssText);
            console.log('Login toggle computed style:', loginToggle ? window.getComputedStyle(loginToggle) : 'Element not found');
            if (loginToggle && loginAdvancedSettings && loginServerInput) {
                // Set default value to current origin
                loginServerInput.value = currentOrigin;
                loginToggle.addEventListener('click', () => {
                    const isHidden = loginAdvancedSettings.classList.contains('hidden');
                    if (isHidden) {
                        loginAdvancedSettings.classList.remove('hidden');
                        loginToggle.textContent = 'Advanced Settings ▲';
                    }
                    else {
                        loginAdvancedSettings.classList.add('hidden');
                        loginToggle.textContent = 'Advanced Settings ▼';
                        // Reset to default when collapsed
                        loginServerInput.value = currentOrigin;
                    }
                });
            }
            // Setup register form advanced settings
            const registerToggle = document.getElementById('advancedSettingsToggleRegister');
            const registerAdvancedSettings = document.getElementById('advancedSettingsRegister');
            const registerServerInput = document.getElementById('serverIP-single');
            console.log('Register elements found:', { registerToggle, registerAdvancedSettings, registerServerInput });
            console.log('Current origin for register:', currentOrigin);
            if (registerToggle && registerAdvancedSettings && registerServerInput) {
                // Set default value to current origin
                registerServerInput.value = currentOrigin;
                registerToggle.addEventListener('click', () => {
                    const isHidden = registerAdvancedSettings.classList.contains('hidden');
                    if (isHidden) {
                        registerAdvancedSettings.classList.remove('hidden');
                        registerToggle.textContent = 'Advanced Settings ▲';
                    }
                    else {
                        registerAdvancedSettings.classList.add('hidden');
                        registerToggle.textContent = 'Advanced Settings ▼';
                        // Reset to default when collapsed
                        registerServerInput.value = currentOrigin;
                    }
                });
            }
        }, 100); // 100ms delay to ensure DOM is ready
    }
    showLoginForm() {
        // console.log('Showing login form');
        // this.loginForm.classList.remove('hidden');
        // this.registerForm.classList.add('hidden');
        // handled in auth_ui.ts
    }
    showRegisterForm() {
        // console.log('Showing register form');
        // this.loginForm.classList.add('hidden');
        // this.registerForm.classList.remove('hidden');
        // handled in auth_ui.ts
    }
    hideAuthContainer() {
        this.authContainer.style.display = 'none';
    }
    showAuthContainer() {
        this.authContainer.style.display = 'block';
    }
    hideGameMenu() {
        this.gameMenu.style.display = 'none';
    }
    showGameMenu() {
        this.gameMenu.style.display = 'flex';
    }
    hideCenterText() {
        this.centerText.style.display = 'none';
    }
    showCenterText() {
        this.centerText.style.display = 'block';
    }
    showExitButton() {
        this.exitButtonContainer.style.display = 'block';
    }
    hideExitButton() {
        this.exitButtonContainer.style.display = 'none';
    }
    showDeathScreen() {
        this.deathScreen.classList.remove('hidden');
    }
    hideDeathScreen() {
        this.deathScreen.classList.add('hidden');
    }
    showLoadingScreen() {
        this.loadingScreen.classList.remove('hidden');
    }
    hideLoadingScreen() {
        this.loadingScreen.classList.add('hidden');
    }
    // Getters for accessing form elements
    getLoginUsername() {
        return this.loginForm.querySelector('#loginUsername');
    }
    getLoginPassword() {
        return this.loginForm.querySelector('#loginPassword');
    }
    getServerIPConnect() {
        return this.loginForm.querySelector('#serverIP-connect');
    }
    getLoginButton() {
        return this.loginForm.querySelector('#loginButton');
    }
    getRegisterUsername() {
        return this.registerForm.querySelector('#registerUsername');
    }
    getRegisterPassword() {
        return this.registerForm.querySelector('#registerPassword');
    }
    getRegisterConfirmPassword() {
        return this.registerForm.querySelector('#registerConfirmPassword');
    }
    getServerIPSingle() {
        return this.registerForm.querySelector('#serverIP-single');
    }
    getRegisterButton() {
        return this.registerForm.querySelector('#registerButton');
    }
    getRegisterOfflineButton() {
        return this.registerForm.querySelector('#registerOfflineButton');
    }
    getMultiPlayerButton() {
        return this.gameMenu.querySelector('#multiPlayerButton');
    }
    getSettingsButton() {
        return this.gameMenu.querySelector('#settingsButton');
    }
    getShowHitboxes() {
        const checkbox = this.settingsMenu.querySelector('#showHitboxesCheckbox');
        return checkbox ? checkbox.checked : false;
    }
    getServerIP() {
        const input = this.settingsMenu.querySelector('#serverIP-settings');
        return input ? input.value : window.location.origin;
    }
    getNameInput() {
        return this.centerText.querySelector('#nameInput');
    }
    getHueSlider() {
        return this.centerText.querySelector('#hueSlider');
    }
    getColorPreview() {
        return this.centerText.querySelector('#colorPreview');
    }
    getUpdateColorButton() {
        return this.centerText.querySelector('#updateColorButton');
    }
    getExitButtonContainer() {
        return this.exitButtonContainer;
    }
}
// CSS styles that were in the HTML
const titleScreenStyles = `
    .auth-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2000;
        background: rgba(0, 0, 0, 0.8);
        padding: 20px;
        border-radius: 10px;
        color: white;
        pointer-events: auto;
    }

    .auth-form {
        display: flex;
        flex-direction: column;
        gap: 15px;
        min-width: 300px;
    }

    .auth-form input {
        padding: 10px;
        border-radius: 5px;
        border: 1px solid #ccc;
    }

    .auth-form button {
        margin: 5px 0;
    }

    .hidden {
        display: none !important;
    }

    .buttons {
        opacity: 1;
        pointer-events: auto;
    }

    .auth-visible .buttons {
        opacity: 0.5;
    }

    .center_text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1000;
        text-align: center;
        color: white;
        padding: 20px;
        border-radius: 10px;
        background: transparent;
        box-shadow: none;
    }

    .title {
        font-size: 48px;
        margin-bottom: 20px;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
        color: #ffffff;
    }

    .instructions {
        font-size: 24px;
        margin-bottom: 30px;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
        color: #ffffff;
    }

    .name-input {
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: #000;
        font-size: 18px;
        padding: 10px;
        width: 300px;
        margin: 10px 0;
        border-radius: 5px;
    }

    .color-picker {
        padding: 15px;
        border-radius: 10px;
        margin-top: 20px;
    }

    .color-picker label {
        color: white;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
    }

    .hue-slider {
        width: 200px;
        margin: 10px 0;
    }

    .color-update-btn {
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: #000;
        padding: 8px 15px;
        border-radius: 5px;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .color-update-btn:hover {
        background: rgba(255, 255, 255, 1);
        transform: scale(1.1);
    }

    #gameMenu {
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 3000;
        text-align: center;
        display: flex;
        gap: 10px;
        padding: 15px;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.7);
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
    }

    #gameMenu button {
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: #000;
        font-weight: bold;
        transition: all 0.3s ease;
        margin: 0 10px;
        padding: 10px 20px;
        font-size: 16px;
        border-radius: 5px;
        cursor: pointer;
    }

    #gameMenu button:hover {
        background: rgba(255, 255, 255, 1);
        transform: scale(1.1);
    }

    button {
        margin: 0 10px;
        padding: 10px 20px;
        font-size: 16px;
        background-color: rgba(255, 255, 255, 0.9);
        border: 2px solid #333;
        border-radius: 5px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    button:hover {
        background-color: rgba(255, 255, 255, 1);
        transform: scale(1.05);
    }

    .settings-menu {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 4000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .settings-menu-content {
        background: rgba(0, 0, 0, 0.8);
        padding: 20px;
        border-radius: 10px;
        color: white;
        width: 500px;
        max-width: 90%;
    }

    .settings-menu-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #444;
        padding-bottom: 10px;
        margin-bottom: 10px;
    }

    #closeSettingsButton {
        background: transparent;
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
    }

    .settings-menu-tabs {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
    }

    .tab-button {
        padding: 10px;
        background: #333;
        border: 1px solid #555;
        color: white;
        cursor: pointer;
        border-radius: 5px;
    }

    .tab-button.active {
        background: #555;
        border-bottom: 1px solid #555;
    }

    .tab-content {
        display: none;
    }

    .tab-content.active {
        display: block;
    }

    .controls-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 10px;
    }

    .control-row {
        display: contents;
    }

    .control-row label {
        text-transform: capitalize;
    }

    .control-input {
        background: #555;
        border: 1px solid #777;
        color: white;
        padding: 5px;
        border-radius: 3px;
        text-align: center;
    }
`;
// Function to inject styles
function injectTitleScreenStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = titleScreenStyles;
    document.head.appendChild(styleElement);
}

;// ./src/index.ts
// ... (keep the existing imports and Player class)



let currentGame = null;
let titleScreen = null;
let authUI = null;
window.onload = () => {
    // Initialize title screen first
    injectTitleScreenStyles();
    titleScreen = new TitleScreen();
    titleScreen.appendToBody();
    // Initialize auth UI after title screen is created
    authUI = new AuthUI();
    // Set up game event listeners
    setupGameEventListeners();
};
function setupGameEventListeners() {
    if (!titleScreen)
        return;
    // Handle multiplayer button click
    const multiPlayerButton = titleScreen.getMultiPlayerButton();
    if (multiPlayerButton) {
        multiPlayerButton.addEventListener('click', () => {
            if (currentGame) {
                // Cleanup previous game
                currentGame.cleanup();
            }
            const showHitboxes = titleScreen?.getShowHitboxes() || false;
            const serverIp = titleScreen?.getServerIP() || window.location.origin;
            currentGame = new Game(showHitboxes, serverIp);
            // Hide menus and show game
            titleScreen?.hideAuthContainer();
            titleScreen?.hideCenterText();
            titleScreen?.hideGameMenu();
            titleScreen?.showExitButton();
        });
    }
    // Handle exit button click
    const exitButton = titleScreen.getExitButtonContainer().querySelector('#exitButton');
    if (exitButton) {
        exitButton.addEventListener('click', () => {
            if (currentGame) {
                currentGame.cleanup();
                currentGame = null;
            }
            // Show menus and hide game
            titleScreen?.showAuthContainer();
            titleScreen?.showCenterText();
            titleScreen?.showGameMenu();
            titleScreen?.hideExitButton();
        });
    }
}
// Add this at the top of index.ts, before the Game class

/******/ })()
;