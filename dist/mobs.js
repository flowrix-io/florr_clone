"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOB_CONFIG = void 0;
exports.getMobStats = getMobStats;
exports.getAllMobTypes = getAllMobTypes;
exports.getMobRarities = getMobRarities;
exports.MOB_CONFIG = {
    bee: {
        common: {
            name: "Common Bee",
            damage: 10,
            health: 10,
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
            range: 100
        },
        uncommon: {
            name: "Common Bee",
            damage: 15,
            health: 15,
            size: 1.2,
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
            range: 100
        },
        rare: {
            name: "Common Bee",
            damage: 20,
            health: 20,
            size: 1.5,
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
            range: 100
        },
        epic: {
            name: "Common Bee",
            damage: 25,
            health: 25,
            size: 1.8,
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
            range: 100
        },
        legendary: {
            name: "Common Bee",
            damage: 35,
            health: 35,
            size: 2.5,
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
            range: 100
        },
        mythic: {
            name: "Common Bee",
            damage: 50,
            health: 50,
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
            range: 100
        }
    },
    ladybug: {
        common: {
            name: "Common Ladybug",
            damage: 10,
            health: 10,
            size: 1.0,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
</svg>`,
            is_hostile: false,
            range: 100
        },
        uncommon: {
            name: "Common Ladybug",
            damage: 10,
            health: 20,
            size: 1.2,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
</svg>`,
            is_hostile: false,
            range: 100
        },
        rare: {
            name: "Common Ladybug",
            damage: 15,
            health: 30,
            size: 1.4,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
</svg>`,
            is_hostile: false,
            range: 100
        },
        epic: {
            name: "Common Ladybug",
            damage: 20,
            health: 25,
            size: 1.8,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
</svg>`,
            is_hostile: false,
            range: 100
        },
        legendary: {
            name: "Common Ladybug",
            damage: 25,
            health: 40,
            size: 2.5,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
</svg>`,
            is_hostile: false,
            range: 100
        },
        mythic: {
            name: "Common Ladybug",
            damage: 30,
            health: 60,
            size: 3.0,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless ladybug that flies peacefully",
            color: "#87CEEB",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
</svg>`,
            is_hostile: false,
            range: 100
        }
    },
    soldier_ant: {
        common: {
            name: "Common Soldier Ant",
            damage: 10,
            health: 10,
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
            range: 100
        },
        uncommon: {
            name: "Common Soldier Ant",
            damage: 10,
            health: 20,
            size: 1.2,
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
            range: 200
        },
        rare: {
            name: "Common Soldier Ant",
            damage: 15,
            health: 30,
            size: 1.4,
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
            range: 350
        },
        epic: {
            name: "Common Soldier Ant",
            damage: 20,
            health: 25,
            size: 1.8,
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
            range: 500
        },
        legendary: {
            name: "Common Soldier Ant",
            damage: 25,
            health: 40,
            size: 2.5,
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
            range: 600
        },
        mythic: {
            name: "Common Soldier Ant",
            damage: 30,
            health: 60,
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
            range: 750
        }
    }
};
function getMobStats(mobType, rarity) {
    return exports.MOB_CONFIG[mobType]?.[rarity] || null;
}
function getAllMobTypes() {
    return Object.keys(exports.MOB_CONFIG);
}
function getMobRarities(mobType) {
    return Object.keys(exports.MOB_CONFIG[mobType] || {});
}
