"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
/**
 * Lays out the spikes along one wall edge, deterministically from `seed`.
 *
 * The spikes and their shadows are drawn by two separate passes, and both used
 * to run their own copy of this loop. They MUST agree exactly — a shadow drawn
 * from a different layout lands next to nothing — so the layout is computed
 * once here and both passes consume the same array.
 */
function layoutEdgeSpikes(edgeLength, seed, minHeight, maxHeight, minWidth, maxWidth, minSpacing, maxSpacing, clusterChance) {
    const spikes = [];
    let seedOffset = 0;
    let inCluster = false;
    let clusterSpikeCount = 0;
    let clusterMaxSpikes = 0;
    let prevSpikeEnd = 0; // Track where previous spike ends to prevent overlap
    while (prevSpikeEnd < edgeLength) {
        const rand = (0, core_1.seededRandom)(seed + seedOffset++);
        // Check if we should start a new cluster
        if (!inCluster && rand < clusterChance) {
            inCluster = true;
            clusterSpikeCount = 0;
            clusterMaxSpikes = 2 + Math.floor((0, core_1.seededRandom)(seed + seedOffset++) * 3); // 2-4 spikes in cluster
        }
        // Calculate spacing from previous spike end
        let spacing = 0;
        if (inCluster && clusterSpikeCount > 0) {
            // Small spacing within cluster
            spacing = minSpacing * 0.3 + (minSpacing * 0.5) * (0, core_1.seededRandom)(seed + seedOffset++);
        }
        else if (!inCluster) {
            // Normal spacing for non-clustered spikes
            spacing = minSpacing + (maxSpacing - minSpacing) * rand;
        }
        // Position spike after previous spike with spacing
        const currentPos = prevSpikeEnd + spacing;
        if (currentPos >= edgeLength)
            break;
        const spikeWidth = minWidth + (maxWidth - minWidth) * (0, core_1.seededRandom)(seed + seedOffset++);
        const spikeHeight = minHeight + (maxHeight - minHeight) * (0, core_1.seededRandom)(seed + seedOffset++);
        // Clustered spikes are wider and can vary in height
        const finalWidth = inCluster ? spikeWidth * (1.3 + (0, core_1.seededRandom)(seed + seedOffset++) * 0.7) : spikeWidth;
        const finalHeight = inCluster ? spikeHeight * (1.1 + (0, core_1.seededRandom)(seed + seedOffset++) * 0.2) : spikeHeight;
        // Ensure spike doesn't go beyond edge
        if (currentPos + finalWidth > edgeLength)
            break;
        spikes.push({ pos: currentPos, width: finalWidth, height: finalHeight, isCluster: inCluster });
        prevSpikeEnd = currentPos + finalWidth;
        if (inCluster) {
            clusterSpikeCount++;
            if (clusterSpikeCount >= clusterMaxSpikes) {
                inCluster = false;
                // Add extra spacing after cluster ends
                prevSpikeEnd += minSpacing * 0.5;
            }
        }
    }
    return spikes;
}
/** The four wall edges, with the seed offset and origin each spike run uses. */
const WALL_EDGES = [
    { direction: 'top', seedOffset: 1, span: (x, y, w) => [x, y, w, 0] },
    { direction: 'bottom', seedOffset: 2, span: (x, y, w, h) => [x, y + h, w, 0] },
    { direction: 'left', seedOffset: 3, span: (x, y, _w, h) => [x, y, 0, h] },
    { direction: 'right', seedOffset: 4, span: (x, y, w, h) => [x + w, y, 0, h] },
];
/**
 * Check if a wall edge is exposed (no adjacent wall)
 */
core_1.Graphics.prototype.isEdgeExposed = function (wall, edge, allWalls) {
    const tolerance = 1; // Small tolerance for floating point comparison
    const x = wall.x;
    const y = wall.y;
    const width = wall.width;
    const height = wall.height;
    switch (edge) {
        case 'top':
            // Check if there's a wall directly above
            return !allWalls.some(other => other !== wall &&
                other.type === 'wall' &&
                Math.abs(other.y + other.height - y) < tolerance &&
                other.x < x + width &&
                other.x + other.width > x);
        case 'bottom':
            // Check if there's a wall directly below
            return !allWalls.some(other => other !== wall &&
                other.type === 'wall' &&
                Math.abs(other.y - (y + height)) < tolerance &&
                other.x < x + width &&
                other.x + other.width > x);
        case 'left':
            // Check if there's a wall directly to the left
            return !allWalls.some(other => other !== wall &&
                other.type === 'wall' &&
                Math.abs(other.x + other.width - x) < tolerance &&
                other.y < y + height &&
                other.y + other.height > y);
        case 'right':
            // Check if there's a wall directly to the right
            return !allWalls.some(other => other !== wall &&
                other.type === 'wall' &&
                Math.abs(other.x - (x + width)) < tolerance &&
                other.y < y + height &&
                other.y + other.height > y);
    }
};
/**
 * Draw spiky edges on a wall using the tiled texture pattern
 * Spikes are randomly positioned and can connect together, with softer curves
 */
core_1.Graphics.prototype.drawWallSpikes = function (x, y, width, height, wall, allWalls, pattern) {
    const minSpikeHeight = 8;
    const maxSpikeHeight = 25;
    const minSpikeWidth = 25;
    const maxSpikeWidth = 50;
    const minSpikeSpacing = 0;
    const maxSpikeSpacing = 20;
    const clusterChance = 0.3; // 30% chance of spikes connecting/clustering
    // Use wall position as seed for consistent randomness
    const baseSeed = (wall.x * 1000 + wall.y) * 1000;
    this.ctx.save();
    this.ctx.fillStyle = pattern;
    for (const edge of WALL_EDGES) {
        if (!this.isEdgeExposed(wall, edge.direction, allWalls))
            continue;
        const [sx, sy, ew, eh] = edge.span(x, y, width, height);
        this.drawRandomSpikesOnEdge(sx, sy, ew, eh, edge.direction, baseSeed + edge.seedOffset, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance);
    }
    this.ctx.restore();
};
/**
 * Draw shadows around wall spikes
 */
core_1.Graphics.prototype.drawWallSpikeShadows = function (x, y, width, height, wall, allWalls, shadowSize) {
    const minSpikeHeight = 8;
    const maxSpikeHeight = 25;
    const minSpikeWidth = 25;
    const maxSpikeWidth = 50;
    const minSpikeSpacing = 0;
    const maxSpikeSpacing = 20;
    const clusterChance = 0.3;
    // Use wall position as seed for consistent randomness (same as drawWallSpikes)
    const baseSeed = (wall.x * 1000 + wall.y) * 1000;
    this.ctx.save();
    for (const edge of WALL_EDGES) {
        if (!this.isEdgeExposed(wall, edge.direction, allWalls))
            continue;
        const [sx, sy, ew, eh] = edge.span(x, y, width, height);
        this.drawRandomSpikeShadowsOnEdge(sx, sy, ew, eh, edge.direction, baseSeed + edge.seedOffset, minSpikeHeight, maxSpikeHeight, minSpikeWidth, maxSpikeWidth, minSpikeSpacing, maxSpikeSpacing, clusterChance, shadowSize);
    }
    this.ctx.restore();
};
/**
 * Draw random spikes along an edge with clustering support
 */
core_1.Graphics.prototype.drawRandomSpikesOnEdge = function (startX, startY, edgeWidth, edgeHeight, direction, seed, minHeight, maxHeight, minWidth, maxWidth, minSpacing, maxSpacing, clusterChance) {
    const spikes = layoutEdgeSpikes(direction === 'top' || direction === 'bottom' ? edgeWidth : edgeHeight, seed, minHeight, maxHeight, minWidth, maxWidth, minSpacing, maxSpacing, clusterChance);
    // Draw the spikes with straight lines (less sharp trapezoid shape)
    spikes.forEach((spike, index) => {
        // Use actual position without overlap adjustment
        const spikeX = direction === 'top' || direction === 'bottom'
            ? startX + spike.pos
            : startX;
        const spikeY = direction === 'left' || direction === 'right'
            ? startY + spike.pos
            : startY;
        const spikeWidth = spike.width;
        const spikeHeight = spike.height;
        // Make spikes less sharp by using a flat top instead of sharp point
        // Top width is 20-40% of base width for less sharp appearance
        const topWidth = spikeWidth * (0.2 + (0, core_1.seededRandom)((spike.pos * 1000) % 1000) * 0.2);
        this.ctx.beginPath();
        if (direction === 'top') {
            // Trapezoid spike pointing upward with flat top
            this.ctx.moveTo(spikeX, spikeY);
            this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY - spikeHeight);
            this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY - spikeHeight);
            this.ctx.lineTo(spikeX + spikeWidth, spikeY);
        }
        else if (direction === 'bottom') {
            // Trapezoid spike pointing downward with flat bottom
            this.ctx.moveTo(spikeX, spikeY);
            this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY + spikeHeight);
            this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY + spikeHeight);
            this.ctx.lineTo(spikeX + spikeWidth, spikeY);
        }
        else if (direction === 'left') {
            // Trapezoid spike pointing left with flat left side
            this.ctx.moveTo(spikeX, spikeY);
            this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
            this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
            this.ctx.lineTo(spikeX, spikeY + spikeWidth);
        }
        else if (direction === 'right') {
            // Trapezoid spike pointing right with flat right side
            this.ctx.moveTo(spikeX, spikeY);
            this.ctx.lineTo(spikeX + spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
            this.ctx.lineTo(spikeX + spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
            this.ctx.lineTo(spikeX, spikeY + spikeWidth);
        }
        this.ctx.closePath();
        // Fill with pattern
        this.ctx.fill();
        // Draw outline only on outer edges (not on the base that connects to wall)
        this.ctx.strokeStyle = '#783f01';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        if (direction === 'top') {
            // Draw outline on left side, top, and right side (skip bottom base)
            // Start from left side of base, go up left edge
            this.ctx.moveTo(spikeX, spikeY);
            this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY - spikeHeight);
            // Draw top edge
            this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY - spikeHeight);
            // Draw right edge down to base
            this.ctx.lineTo(spikeX + spikeWidth, spikeY);
            // Don't draw the base edge
        }
        else if (direction === 'bottom') {
            // Draw outline on left side, bottom, and right side (skip top base)
            // Start from left side of base, go down left edge
            this.ctx.moveTo(spikeX, spikeY);
            this.ctx.lineTo(spikeX + (spikeWidth - topWidth) / 2, spikeY + spikeHeight);
            // Draw bottom edge
            this.ctx.lineTo(spikeX + (spikeWidth + topWidth) / 2, spikeY + spikeHeight);
            // Draw right edge up to base
            this.ctx.lineTo(spikeX + spikeWidth, spikeY);
            // Don't draw the base edge
        }
        else if (direction === 'left') {
            // Draw outline on top, left side, and bottom (skip right base)
            // Start from top of base, go left along top edge
            this.ctx.moveTo(spikeX, spikeY);
            this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
            // Draw left edge
            this.ctx.lineTo(spikeX - spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
            // Draw bottom edge back to base
            this.ctx.lineTo(spikeX, spikeY + spikeWidth);
            // Don't draw the base edge
        }
        else if (direction === 'right') {
            // Draw outline on top, right side, and bottom (skip left base)
            // Start from top of base, go right along top edge
            this.ctx.moveTo(spikeX, spikeY);
            this.ctx.lineTo(spikeX + spikeHeight, spikeY + (spikeWidth - topWidth) / 2);
            // Draw right edge
            this.ctx.lineTo(spikeX + spikeHeight, spikeY + (spikeWidth + topWidth) / 2);
            // Draw bottom edge back to base
            this.ctx.lineTo(spikeX, spikeY + spikeWidth);
            // Don't draw the base edge
        }
        this.ctx.stroke();
    });
};
/**
 * Draw shadows around random spikes along an edge (mirrors drawRandomSpikesOnEdge logic)
 */
core_1.Graphics.prototype.drawRandomSpikeShadowsOnEdge = function (startX, startY, edgeWidth, edgeHeight, direction, seed, minHeight, maxHeight, minWidth, maxWidth, minSpacing, maxSpacing, clusterChance, shadowSize) {
    const spikes = layoutEdgeSpikes(direction === 'top' || direction === 'bottom' ? edgeWidth : edgeHeight, seed, minHeight, maxHeight, minWidth, maxWidth, minSpacing, maxSpacing, clusterChance);
    // Draw shadows around each spike
    spikes.forEach((spike) => {
        const spikeX = direction === 'top' || direction === 'bottom'
            ? startX + spike.pos
            : startX;
        const spikeY = direction === 'left' || direction === 'right'
            ? startY + spike.pos
            : startY;
        const spikeWidth = spike.width;
        const spikeHeight = spike.height;
        const topWidth = spikeWidth * (0.2 + (0, core_1.seededRandom)((spike.pos * 1000) % 1000) * 0.2);
        // Sample color at the center of the shadow area for this spike
        let shadowCenterX;
        let shadowCenterY;
        if (direction === 'top') {
            shadowCenterX = spikeX + spikeWidth / 2;
            shadowCenterY = spikeY - spikeHeight - shadowSize / 2;
        }
        else if (direction === 'bottom') {
            shadowCenterX = spikeX + spikeWidth / 2;
            shadowCenterY = spikeY + spikeHeight + shadowSize / 2;
        }
        else if (direction === 'left') {
            shadowCenterX = spikeX - spikeHeight - shadowSize / 2;
            shadowCenterY = spikeY + spikeWidth / 2;
        }
        else { // right
            shadowCenterX = spikeX + spikeHeight + shadowSize / 2;
            shadowCenterY = spikeY + spikeWidth / 2;
        }
        const shadowColor = this.sampleColorAtPosition(shadowCenterX, shadowCenterY);
        // Set fill style before drawing the path
        this.ctx.fillStyle = shadowColor;
        this.ctx.beginPath();
        // Draw shadow path that extends around all edges of the spike shape
        // The shadow extends shadowSize pixels outward from each edge
        if (direction === 'top') {
            // Shadow around top spike - create outer path
            const leftX = spikeX + (spikeWidth - topWidth) / 2;
            const rightX = spikeX + (spikeWidth + topWidth) / 2;
            const topY = spikeY - spikeHeight;
            // Start from left base, go around the spike
            this.ctx.moveTo(spikeX - shadowSize, spikeY);
            // Left edge shadow
            this.ctx.lineTo(leftX - shadowSize, topY - shadowSize);
            // Top edge shadow
            this.ctx.lineTo(rightX + shadowSize, topY - shadowSize);
            // Right edge shadow
            this.ctx.lineTo(spikeX + spikeWidth + shadowSize, spikeY);
        }
        else if (direction === 'bottom') {
            // Shadow around bottom spike - create outer path
            const leftX = spikeX + (spikeWidth - topWidth) / 2;
            const rightX = spikeX + (spikeWidth + topWidth) / 2;
            const bottomY = spikeY + spikeHeight;
            // Start from left base, go around the spike
            this.ctx.moveTo(spikeX - shadowSize, spikeY);
            // Left edge shadow
            this.ctx.lineTo(leftX - shadowSize, bottomY + shadowSize);
            // Bottom edge shadow
            this.ctx.lineTo(rightX + shadowSize, bottomY + shadowSize);
            // Right edge shadow
            this.ctx.lineTo(spikeX + spikeWidth + shadowSize, spikeY);
        }
        else if (direction === 'left') {
            // Shadow around left spike - create outer path
            const topY = spikeY + (spikeWidth - topWidth) / 2;
            const bottomY = spikeY + (spikeWidth + topWidth) / 2;
            const leftX = spikeX - spikeHeight;
            // Start from top base, go around the spike
            this.ctx.moveTo(spikeX, spikeY - shadowSize);
            // Top edge shadow
            this.ctx.lineTo(leftX - shadowSize, topY - shadowSize);
            // Left edge shadow
            this.ctx.lineTo(leftX - shadowSize, bottomY + shadowSize);
            // Bottom edge shadow
            this.ctx.lineTo(spikeX, spikeY + spikeWidth + shadowSize);
        }
        else if (direction === 'right') {
            // Shadow around right spike - create outer path
            const topY = spikeY + (spikeWidth - topWidth) / 2;
            const bottomY = spikeY + (spikeWidth + topWidth) / 2;
            const rightX = spikeX + spikeHeight;
            // Start from top base, go around the spike
            this.ctx.moveTo(spikeX, spikeY - shadowSize);
            // Top edge shadow
            this.ctx.lineTo(rightX + shadowSize, topY - shadowSize);
            // Right edge shadow
            this.ctx.lineTo(rightX + shadowSize, bottomY + shadowSize);
            // Bottom edge shadow
            this.ctx.lineTo(spikeX, spikeY + spikeWidth + shadowSize);
        }
        this.ctx.closePath();
        this.ctx.fill();
    });
};
/**
 * Draw a jagged edge protrusion on an exposed wall tile edge
 */
core_1.Graphics.prototype.drawJaggedEdge = function (worldX, worldY, edge, points, pattern) {
    this.ctx.save();
    this.ctx.fillStyle = pattern;
    // Draw filled region between straight tile edge and jagged polyline
    this.ctx.beginPath();
    if (edge === 'top') {
        this.ctx.moveTo(worldX + points[0].t, worldY);
        for (const pt of points) {
            this.ctx.lineTo(worldX + pt.t, worldY - pt.offset);
        }
        this.ctx.lineTo(worldX + points[points.length - 1].t, worldY);
    }
    else if (edge === 'bottom') {
        const baseY = worldY + core_1.WALL_TILE_SIZE;
        this.ctx.moveTo(worldX + points[0].t, baseY);
        for (const pt of points) {
            this.ctx.lineTo(worldX + pt.t, baseY + pt.offset);
        }
        this.ctx.lineTo(worldX + points[points.length - 1].t, baseY);
    }
    else if (edge === 'left') {
        this.ctx.moveTo(worldX, worldY + points[0].t);
        for (const pt of points) {
            this.ctx.lineTo(worldX - pt.offset, worldY + pt.t);
        }
        this.ctx.lineTo(worldX, worldY + points[points.length - 1].t);
    }
    else if (edge === 'right') {
        const baseX = worldX + core_1.WALL_TILE_SIZE;
        this.ctx.moveTo(baseX, worldY + points[0].t);
        for (const pt of points) {
            this.ctx.lineTo(baseX + pt.offset, worldY + pt.t);
        }
        this.ctx.lineTo(baseX, worldY + points[points.length - 1].t);
    }
    this.ctx.closePath();
    this.ctx.fill();
    // Draw dark brown outline matching wall dot color
    this.ctx.strokeStyle = '#783f01';
    this.ctx.lineWidth = 3;
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    if (edge === 'top') {
        this.ctx.moveTo(worldX + points[0].t, worldY - points[0].offset);
        for (let i = 1; i < points.length; i++) {
            this.ctx.lineTo(worldX + points[i].t, worldY - points[i].offset);
        }
    }
    else if (edge === 'bottom') {
        const baseY = worldY + core_1.WALL_TILE_SIZE;
        this.ctx.moveTo(worldX + points[0].t, baseY + points[0].offset);
        for (let i = 1; i < points.length; i++) {
            this.ctx.lineTo(worldX + points[i].t, baseY + points[i].offset);
        }
    }
    else if (edge === 'left') {
        this.ctx.moveTo(worldX - points[0].offset, worldY + points[0].t);
        for (let i = 1; i < points.length; i++) {
            this.ctx.lineTo(worldX - points[i].offset, worldY + points[i].t);
        }
    }
    else if (edge === 'right') {
        const baseX = worldX + core_1.WALL_TILE_SIZE;
        this.ctx.moveTo(baseX + points[0].offset, worldY + points[0].t);
        for (let i = 1; i < points.length; i++) {
            this.ctx.lineTo(baseX + points[i].offset, worldY + points[i].t);
        }
    }
    this.ctx.stroke();
    this.ctx.restore();
};
/**
 * Draw a smooth curved edge protrusion on an exposed water tile edge.
 * Uses quadratic bezier curves through the jagged points for a smooth water look.
 */
core_1.Graphics.prototype.drawSmoothedEdge = function (worldX, worldY, edge, points, fillColor, strokeColor) {
    if (points.length < 3)
        return;
    this.ctx.save();
    this.ctx.fillStyle = fillColor;
    // Helper to get world coords from a JaggedPoint for each edge direction
    const getXY = (pt) => {
        if (edge === 'top')
            return [worldX + pt.t, worldY - pt.offset];
        if (edge === 'bottom')
            return [worldX + pt.t, worldY + core_1.WALL_TILE_SIZE + pt.offset];
        if (edge === 'left')
            return [worldX - pt.offset, worldY + pt.t];
        // right
        return [worldX + core_1.WALL_TILE_SIZE + pt.offset, worldY + pt.t];
    };
    const getBase = (pt) => {
        if (edge === 'top')
            return [worldX + pt.t, worldY];
        if (edge === 'bottom')
            return [worldX + pt.t, worldY + core_1.WALL_TILE_SIZE];
        if (edge === 'left')
            return [worldX, worldY + pt.t];
        // right
        return [worldX + core_1.WALL_TILE_SIZE, worldY + pt.t];
    };
    // Draw filled region with smooth curves
    this.ctx.beginPath();
    const [startBaseX, startBaseY] = getBase(points[0]);
    this.ctx.moveTo(startBaseX, startBaseY);
    // Smooth curve through the jagged points using quadratic bezier
    const [firstX, firstY] = getXY(points[0]);
    this.ctx.lineTo(firstX, firstY);
    for (let i = 1; i < points.length - 1; i++) {
        const [px, py] = getXY(points[i]);
        const [nx, ny] = getXY(points[i + 1]);
        const cpx = px;
        const cpy = py;
        const endx = (px + nx) / 2;
        const endy = (py + ny) / 2;
        this.ctx.quadraticCurveTo(cpx, cpy, endx, endy);
    }
    const [lastX, lastY] = getXY(points[points.length - 1]);
    this.ctx.lineTo(lastX, lastY);
    const [endBaseX, endBaseY] = getBase(points[points.length - 1]);
    this.ctx.lineTo(endBaseX, endBaseY);
    this.ctx.closePath();
    this.ctx.fill();
    // Draw smooth outline along the curved edge only
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = 2;
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(firstX, firstY);
    for (let i = 1; i < points.length - 1; i++) {
        const [px, py] = getXY(points[i]);
        const [nx, ny] = getXY(points[i + 1]);
        const endx = (px + nx) / 2;
        const endy = (py + ny) / 2;
        this.ctx.quadraticCurveTo(px, py, endx, endy);
    }
    this.ctx.lineTo(lastX, lastY);
    this.ctx.stroke();
    this.ctx.restore();
};
