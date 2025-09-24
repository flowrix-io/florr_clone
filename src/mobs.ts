export interface MobStats {
    name: string;
    damage: number;
    health: number;
    size: number;
    speed: number; // Movement speed
    cooldown: number; // Attack cooldown time in milliseconds
    description: string;
    color: string;
    image: string; // 32x32 SVG image
    is_hostile: boolean; // Whether the mob attacks players
    range: number; // Detection/attack range
}

export interface MobConfig {
    [mobType: string]: {
        [rarity: string]: MobStats;
    };
}

export const MOB_CONFIG: MobConfig = {
    fish: {
        common: {
            name: "Common Fish",
            damage: 5,
            health: 5,
            size: 1.0,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A small, harmless fish that swims peacefully",
            color: "#87CEEB",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="12" ry="8" fill="#87CEEB" stroke="#4682B4" stroke-width="2"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M4 16 L8 12 L8 20 Z" fill="#87CEEB"/>
</svg>`,
            is_hostile: false,
            range: 100
        },
        uncommon: {
            name: "School Fish",
            damage: 8,
            health: 15,
            size: 1.2,
            speed: 0.75,
            cooldown: 1800, // 1.8 seconds
            description: "A larger fish that moves in schools",
            color: "#20B2AA",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="14" ry="9" fill="#20B2AA" stroke="#008B8B" stroke-width="2"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M2 16 L6 12 L6 20 Z" fill="#20B2AA"/>
</svg>`,
            is_hostile: false,
            range: 150
        },
        rare: {
            name: "Tropical Fish",
            damage: 12,
            health: 25,
            size: 1.4,
            speed: 1.0,
            cooldown: 1600, // 1.6 seconds
            description: "A colorful tropical fish with vibrant patterns",
            color: "#FF6347",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="15" ry="10" fill="#FF6347" stroke="#DC143C" stroke-width="2"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M1 16 L5 12 L5 20 Z" fill="#FF6347"/>
<circle cx="12" cy="12" r="1" fill="#FFD700"/>
<circle cx="20" cy="20" r="1" fill="#FFD700"/>
</svg>`,
            is_hostile: false,
            range: 200
        },
        epic: {
            name: "Predator Fish",
            damage: 20,
            health: 40,
            size: 1.6,
            speed: 1.25,
            cooldown: 1400, // 1.4 seconds
            description: "A predatory fish that hunts smaller creatures",
            color: "#8B0000",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="16" ry="11" fill="#8B0000" stroke="#A0522D" stroke-width="2"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M0 16 L4 12 L4 20 Z" fill="#8B0000"/>
<path d="M16 4 L20 8 L12 8 Z" fill="#8B0000"/>
<path d="M16 28 L20 24 L12 24 Z" fill="#8B0000"/>
</svg>`,
            is_hostile: true,
            range: 300
        },
        legendary: {
            name: "Ancient Fish",
            damage: 30,
            health: 60,
            size: 1.8,
            speed: 1.5,
            cooldown: 1200, // 1.2 seconds
            description: "An ancient fish with mystical powers",
            color: "#4B0082",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="17" ry="12" fill="#4B0082" stroke="#800080" stroke-width="2"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M-1 16 L3 12 L3 20 Z" fill="#4B0082"/>
<circle cx="8" cy="8" r="1" fill="#FFD700"/>
<circle cx="24" cy="8" r="1" fill="#FFD700"/>
<circle cx="8" cy="24" r="1" fill="#FFD700"/>
<circle cx="24" cy="24" r="1" fill="#FFD700"/>
</svg>`,
            is_hostile: true,
            range: 400
        },
        mythic: {
            name: "Leviathan Fish",
            damage: 50,
            health: 100,
            size: 2.0,
            speed: 2.0,
            cooldown: 1000, // 1 second
            description: "A legendary leviathan of the deep ocean",
            color: "#000080",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="18" ry="13" fill="#000080" stroke="#0000FF" stroke-width="2"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M-2 16 L2 12 L2 20 Z" fill="#000080"/>
<circle cx="6" cy="6" r="1" fill="#FFD700"/>
<circle cx="26" cy="6" r="1" fill="#FFD700"/>
<circle cx="6" cy="26" r="1" fill="#FFD700"/>
<circle cx="26" cy="26" r="1" fill="#FFD700"/>
<circle cx="16" cy="4" r="1" fill="#FFD700"/>
<circle cx="16" cy="28" r="1" fill="#FFD700"/>
</svg>`,
            is_hostile: true,
            range: 500
        }
    },
    octopus: {
        common: {
            name: "Common Octopus",
            damage: 8,
            health: 10,
            size: 1.0,
            speed: 0.6,
            cooldown: 2500, // 2.5 seconds
            description: "A small octopus that hides in coral",
            color: "#8B4513",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="8" fill="#8B4513"/>
<path d="M8 8 Q12 4 16 8 Q20 4 24 8" stroke="#8B4513" stroke-width="2" fill="none"/>
<path d="M8 24 Q12 28 16 24 Q20 28 24 24" stroke="#8B4513" stroke-width="2" fill="none"/>
<circle cx="14" cy="14" r="1" fill="#000"/>
<circle cx="18" cy="14" r="1" fill="#000"/>
</svg>`,
            is_hostile: false,
            range: 120
        },
        uncommon: {
            name: "Coral Octopus",
            damage: 12,
            health: 20,
            size: 1.2,
            speed: 0.8,
            cooldown: 2200, // 2.2 seconds
            description: "An octopus that camouflages with coral",
            color: "#CD853F",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="9" fill="#CD853F"/>
<path d="M7 7 Q11 3 15 7 Q19 3 23 7" stroke="#CD853F" stroke-width="2" fill="none"/>
<path d="M7 25 Q11 29 15 25 Q19 29 23 25" stroke="#CD853F" stroke-width="2" fill="none"/>
<circle cx="14" cy="14" r="1" fill="#000"/>
<circle cx="18" cy="14" r="1" fill="#000"/>
<circle cx="12" cy="18" r="0.5" fill="#FF6347"/>
<circle cx="20" cy="18" r="0.5" fill="#FF6347"/>
</svg>`,
            is_hostile: false,
            range: 150
        },
        rare: {
            name: "Electric Octopus",
            damage: 18,
            health: 35,
            size: 1.4,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "An octopus that generates electric shocks",
            color: "#FFD700",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="10" fill="#FFD700"/>
<path d="M6 6 Q10 2 14 6 Q18 2 22 6" stroke="#FFD700" stroke-width="2" fill="none"/>
<path d="M6 26 Q10 30 14 26 Q18 30 22 26" stroke="#FFD700" stroke-width="2" fill="none"/>
<circle cx="14" cy="14" r="1" fill="#000"/>
<circle cx="18" cy="14" r="1" fill="#000"/>
<path d="M8 12 L10 10 M22 12 L20 10 M8 20 L10 22 M22 20 L20 22" stroke="#FF4500" stroke-width="1"/>
</svg>`,
            is_hostile: true,
            range: 200
        },
        epic: {
            name: "Kraken Octopus",
            damage: 25,
            health: 50,
            size: 1.6,
            speed: 1.2,
            cooldown: 1800, // 1.8 seconds
            description: "A massive octopus with powerful tentacles",
            color: "#800080",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="11" fill="#800080"/>
<path d="M5 5 Q9 1 13 5 Q17 1 21 5 Q25 1 27 5" stroke="#800080" stroke-width="2" fill="none"/>
<path d="M5 27 Q9 31 13 27 Q17 31 21 27 Q25 31 27 27" stroke="#800080" stroke-width="2" fill="none"/>
<circle cx="14" cy="14" r="1" fill="#000"/>
<circle cx="18" cy="14" r="1" fill="#000"/>
<path d="M6 10 L8 8 M24 10 L22 8 M6 22 L8 24 M24 22 L22 24" stroke="#FF4500" stroke-width="2"/>
</svg>`,
            is_hostile: true,
            range: 300
        },
        legendary: {
            name: "Void Octopus",
            damage: 40,
            health: 80,
            size: 1.8,
            speed: 1.5,
            cooldown: 1600, // 1.6 seconds
            description: "An octopus from the void between dimensions",
            color: "#2F4F4F",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="12" fill="#2F4F4F"/>
<path d="M4 4 Q8 0 12 4 Q16 0 20 4 Q24 0 28 4" stroke="#2F4F4F" stroke-width="2" fill="none"/>
<path d="M4 28 Q8 32 12 28 Q16 32 20 28 Q24 32 28 28" stroke="#2F4F4F" stroke-width="2" fill="none"/>
<circle cx="14" cy="14" r="1" fill="#000"/>
<circle cx="18" cy="14" r="1" fill="#000"/>
<path d="M4 8 L6 6 M26 8 L24 6 M4 24 L6 26 M26 24 L24 26" stroke="#FF4500" stroke-width="2"/>
<circle cx="8" cy="8" r="0.5" fill="#FFD700"/>
<circle cx="24" cy="8" r="0.5" fill="#FFD700"/>
<circle cx="8" cy="24" r="0.5" fill="#FFD700"/>
<circle cx="24" cy="24" r="0.5" fill="#FFD700"/>
</svg>`,
            is_hostile: true,
            range: 400
        },
        mythic: {
            name: "Elder Kraken",
            damage: 60,
            health: 120,
            size: 2.0,
            speed: 1.8,
            cooldown: 1400, // 1.4 seconds
            description: "The ancient elder kraken, master of the depths",
            color: "#000000",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="13" fill="#000000"/>
<path d="M3 3 Q7 -1 11 3 Q15 -1 19 3 Q23 -1 27 3 Q29 1 29 3" stroke="#000000" stroke-width="2" fill="none"/>
<path d="M3 29 Q7 33 11 29 Q15 33 19 29 Q23 33 27 29 Q29 31 29 29" stroke="#000000" stroke-width="2" fill="none"/>
<circle cx="14" cy="14" r="1" fill="#000"/>
<circle cx="18" cy="14" r="1" fill="#000"/>
<path d="M2 6 L4 4 M28 6 L26 4 M2 26 L4 28 M28 26 L26 28" stroke="#FF4500" stroke-width="2"/>
<circle cx="6" cy="6" r="0.5" fill="#FFD700"/>
<circle cx="26" cy="6" r="0.5" fill="#FFD700"/>
<circle cx="6" cy="26" r="0.5" fill="#FFD700"/>
<circle cx="26" cy="26" r="0.5" fill="#FFD700"/>
<circle cx="16" cy="2" r="0.5" fill="#FFD700"/>
<circle cx="16" cy="30" r="0.5" fill="#FFD700"/>
</svg>`,
            is_hostile: true,
            range: 500
        }
    },
    shark: {
        common: {
            name: "Small Shark",
            damage: 15,
            health: 20,
            size: 1.2,
            speed: 1.0,
            cooldown: 3000, // 3 seconds
            description: "A small but aggressive shark",
            color: "#708090",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="14" ry="8" fill="#708090" stroke="#2F4F4F" stroke-width="2"/>
<path d="M2 16 L6 12 L6 20 Z" fill="#708090"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M8 8 L12 12 M8 24 L12 20" stroke="#2F4F4F" stroke-width="1"/>
</svg>`,
            is_hostile: true,
            range: 250
        },
        uncommon: {
            name: "Reef Shark",
            damage: 22,
            health: 35,
            size: 1.4,
            speed: 1.2,
            cooldown: 2800, // 2.8 seconds
            description: "A reef shark that patrols coral areas",
            color: "#4682B4",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="15" ry="9" fill="#4682B4" stroke="#2F4F4F" stroke-width="2"/>
<path d="M1 16 L5 12 L5 20 Z" fill="#4682B4"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M6 6 L10 10 M6 26 L10 22" stroke="#2F4F4F" stroke-width="1"/>
<circle cx="12" cy="12" r="0.5" fill="#FF6347"/>
<circle cx="20" cy="20" r="0.5" fill="#FF6347"/>
</svg>`,
            is_hostile: true,
            range: 300
        },
        rare: {
            name: "Tiger Shark",
            damage: 30,
            health: 50,
            size: 1.6,
            speed: 1.4,
            cooldown: 2600, // 2.6 seconds
            description: "A tiger shark with distinctive stripes",
            color: "#8B4513",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="16" ry="10" fill="#8B4513" stroke="#2F4F4F" stroke-width="2"/>
<path d="M0 16 L4 12 L4 20 Z" fill="#8B4513"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M4 4 L8 8 M4 28 L8 24" stroke="#2F4F4F" stroke-width="1"/>
<path d="M8 8 L12 8 M8 24 L12 24 M12 12 L16 12 M12 20 L16 20" stroke="#000000" stroke-width="1"/>
</svg>`,
            is_hostile: true,
            range: 350
        },
        epic: {
            name: "Great White Shark",
            damage: 45,
            health: 80,
            size: 1.8,
            speed: 1.6,
            cooldown: 2400, // 2.4 seconds
            description: "A massive great white shark",
            color: "#C0C0C0",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="17" ry="11" fill="#C0C0C0" stroke="#2F4F4F" stroke-width="2"/>
<path d="M-1 16 L3 12 L3 20 Z" fill="#C0C0C0"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M2 2 L6 6 M2 30 L6 26" stroke="#2F4F4F" stroke-width="1"/>
<path d="M6 6 L10 6 M6 26 L10 26 M10 10 L14 10 M10 22 L14 22 M14 14 L18 14 M14 18 L18 18" stroke="#000000" stroke-width="1"/>
</svg>`,
            is_hostile: true,
            range: 400
        },
        legendary: {
            name: "Megalodon",
            damage: 70,
            health: 120,
            size: 2.0,
            speed: 1.8,
            cooldown: 2200, // 2.2 seconds
            description: "An ancient megalodon from prehistoric times",
            color: "#2F4F4F",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="18" ry="12" fill="#2F4F4F" stroke="#000000" stroke-width="2"/>
<path d="M-2 16 L2 12 L2 20 Z" fill="#2F4F4F"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M0 0 L4 4 M0 32 L4 28" stroke="#000000" stroke-width="1"/>
<path d="M4 4 L8 4 M4 28 L8 28 M8 8 L12 8 M8 24 L12 24 M12 12 L16 12 M12 20 L16 20 M16 16 L20 16" stroke="#FFD700" stroke-width="1"/>
</svg>`,
            is_hostile: true,
            range: 500
        },
        mythic: {
            name: "Leviathan Shark",
            damage: 100,
            health: 200,
            size: 2.2,
            speed: 2.0,
            cooldown: 2000, // 2 seconds
            description: "The legendary leviathan shark, king of the ocean",
            color: "#000080",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="19" ry="13" fill="#000080" stroke="#0000FF" stroke-width="2"/>
<path d="M-3 16 L1 12 L1 20 Z" fill="#000080"/>
<circle cx="20" cy="14" r="2" fill="#000"/>
<path d="M-1 -1 L3 3 M-1 33 L3 29" stroke="#0000FF" stroke-width="1"/>
<path d="M3 3 L7 3 M3 29 L7 29 M7 7 L11 7 M7 25 L11 25 M11 11 L15 11 M11 21 L15 21 M15 15 L19 15 M15 17 L19 17" stroke="#FFD700" stroke-width="1"/>
<circle cx="8" cy="8" r="0.5" fill="#FFD700"/>
<circle cx="24" cy="8" r="0.5" fill="#FFD700"/>
<circle cx="8" cy="24" r="0.5" fill="#FFD700"/>
<circle cx="24" cy="24" r="0.5" fill="#FFD700"/>
</svg>`,
            is_hostile: true,
            range: 600
        }
    }
};

export function getMobStats(mobType: string, rarity: string): MobStats | null {
    return MOB_CONFIG[mobType]?.[rarity] || null;
}

export function getAllMobTypes(): string[] {
    return Object.keys(MOB_CONFIG);
}

export function getMobRarities(mobType: string): string[] {
    return Object.keys(MOB_CONFIG[mobType] || {});
}
