"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PETAL_CONFIG = void 0;
exports.getPetalStats = getPetalStats;
exports.getAllPetalTypes = getAllPetalTypes;
exports.getPetalRarities = getPetalRarities;
exports.PETAL_CONFIG = {
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
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
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
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
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
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
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
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
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
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
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
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
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
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
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
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
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
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
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
            count: 3, // Spawns 3 petals per equipped item
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 2, // Spawns 2 petals per equipped item
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
            count: 1,
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
    },
    light: {
        common: {
            name: "Light Petal",
            damage: 5,
            health: 5,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A light petal that provides basic protection",
            color: "#90EE90",
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
        },
        uncommon: {
            name: "Enhanced Light Petal",
            damage: 15,
            health: 15,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "An improved light petal with better stats",
            color: "#32CD32",
            count: 2,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
        },
        rare: {
            name: "Royal Light Petal",
            damage: 45,
            health: 45,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A majestic light petal fit for royalty",
            color: "#8B0000",
            count: 2,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
        },
        epic: {
            name: "Divine Light Petal",
            damage: 135,
            health: 135,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A divine light petal blessed with power",
            color: "#B22222",
            count: 3,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
        },
        legendary: {
            name: "Eternal Light Petal",
            damage: 405,
            health: 405,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "An eternal light petal that never wilts",
            color: "#FF1493",
            count: 3,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
        },
        mythic: {
            name: "Celestial Light Petal",
            damage: 1215,
            health: 1215,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A celestial light petal from the heavens",
            color: "#FF6347",
            count: 5,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
        },
        ultra: {
            name: "Ultra Light Petal",
            damage: 3645,
            health: 3645,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "An ultra light petal with cosmic power",
            color: "#de1f65",
            count: 5,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
        },
        super: {
            name: "Super Light Petal",
            damage: 10935,
            health: 10935,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A super light petal with divine energy",
            color: "#2bffa4",
            count: 5,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
        },
        unique: {
            name: "Unique Light Petal",
            damage: 32805,
            health: 32805,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A unique light petal of ultimate power",
            color: "#bf00ff",
            count: 5,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
        }
    },
    rock: {
        common: {
            name: "Rock Petal",
            damage: 15,
            health: 45,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A rock petal that provides basic protection",
            color: "#8B0000",
            count: 1,
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>
`
        },
        uncommon: {
            name: "Enhanced Rock Petal",
            damage: 45,
            health: 135,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "An improved rock petal with better stats",
            color: "#32CD32",
            count: 1,
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>
`
        },
        rare: {
            name: "Royal Rock Petal",
            damage: 135,
            health: 405,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A majestic rock petal fit for royalty",
            color: "#8B0000",
            count: 1,
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>
`
        },
        epic: {
            name: "Divine Rock Petal",
            damage: 405,
            health: 1215,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A divine rock petal blessed with power",
            color: "#B22222",
            count: 1,
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>
`
        },
        legendary: {
            name: "Eternal Rock Petal",
            damage: 1215,
            health: 3645,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "An eternal rock petal that never wilts",
            color: "#FF1493",
            count: 1,
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>
`
        },
        mythic: {
            name: "Celestial Rock Petal",
            damage: 3645,
            health: 10935,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A celestial rock petal from the heavens",
            color: "#FF6347",
            count: 1,
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>
`
        },
        ultra: {
            name: "Ultra Rock Petal",
            damage: 10935,
            health: 32805,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "An ultra rock petal with cosmic power",
            color: "#de1f65",
            count: 1,
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>
`
        },
        super: {
            name: "Super Rock Petal",
            damage: 32805,
            health: 98415,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A super rock petal with divine energy",
            color: "#2bffa4",
            count: 1,
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>
`
        },
        unique: {
            name: "Unique Rock Petal",
            damage: 98415,
            health: 295245,
            size: 1.0,
            speed: 1.0,
            cooldown: 400,
            knockback: 1,
            description: "A unique rock petal of ultimate power",
            color: "#bf00ff",
            count: 1,
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>
`
        }
    }
};
function getPetalStats(petalType, rarity) {
    return exports.PETAL_CONFIG[petalType]?.[rarity] || null;
}
function getAllPetalTypes() {
    return Object.keys(exports.PETAL_CONFIG);
}
function getPetalRarities(petalType) {
    return Object.keys(exports.PETAL_CONFIG[petalType] || {});
}
