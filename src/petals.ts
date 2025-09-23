export interface PetalStats {
    name: string;
    damage: number;
    health: number;
    size: number;
    speed: number; // Rotation speed multiplier
    description: string;
    color: string;
    image: string; // 32x32 SVG image
}

export interface PetalConfig {
    [petalType: string]: {
        [rarity: string]: PetalStats;
    };
}

export const PETAL_CONFIG: PetalConfig = {
    basic: {
        common: {
            name: "Basic Petal",
            damage: 5,
            health: 10,
            size: 1.0,
            speed: 1.0,
            description: "A simple petal that provides basic protection",
            color: "#90EE90",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="12" ry="8" fill="#90EE90" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="10" ry="6" fill="#98FB98" opacity="0.7"/>
            </svg>`
        },
        uncommon: {
            name: "Enhanced Basic Petal",
            damage: 8,
            health: 15,
            size: 1.1,
            speed: 1.0,
            description: "An improved basic petal with better stats",
            color: "#32CD32",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="13" ry="9" fill="#32CD32" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="11" ry="7" fill="#7CFC00" opacity="0.7"/>
                <ellipse cx="16" cy="16" rx="9" ry="5" fill="#ADFF2F" opacity="0.5"/>
            </svg>`
        },
        rare: {
            name: "Superior Basic Petal",
            damage: 12,
            health: 22,
            size: 1.2,
            speed: 1.0,
            description: "A superior basic petal with enhanced capabilities",
            color: "#228B22",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="14" ry="10" fill="#228B22" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="12" ry="8" fill="#32CD32" opacity="0.8"/>
                <ellipse cx="16" cy="16" rx="10" ry="6" fill="#7CFC00" opacity="0.6"/>
                <ellipse cx="16" cy="16" rx="8" ry="4" fill="#ADFF2F" opacity="0.4"/>
            </svg>`
        },
        epic: {
            name: "Elite Basic Petal",
            damage: 18,
            health: 32,
            size: 1.3,
            speed: 1.0,
            description: "An elite basic petal with impressive power",
            color: "#006400",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="15" ry="11" fill="#006400" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="13" ry="9" fill="#228B22" opacity="0.8"/>
                <ellipse cx="16" cy="16" rx="11" ry="7" fill="#32CD32" opacity="0.6"/>
                <ellipse cx="16" cy="16" rx="9" ry="5" fill="#7CFC00" opacity="0.4"/>
                <ellipse cx="16" cy="16" rx="7" ry="3" fill="#ADFF2F" opacity="0.2"/>
            </svg>`
        },
        legendary: {
            name: "Legendary Basic Petal",
            damage: 26,
            health: 45,
            size: 1.4,
            speed: 1.0,
            description: "A legendary basic petal of immense strength",
            color: "#8B4513",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="16" ry="12" fill="#8B4513" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="14" ry="10" fill="#A0522D" opacity="0.8"/>
                <ellipse cx="16" cy="16" rx="12" ry="8" fill="#D2691E" opacity="0.6"/>
                <ellipse cx="16" cy="16" rx="10" ry="6" fill="#F4A460" opacity="0.4"/>
                <ellipse cx="16" cy="16" rx="8" ry="4" fill="#FFD700" opacity="0.2"/>
            </svg>`
        },
        mythic: {
            name: "Mythic Basic Petal",
            damage: 40,
            health: 65,
            size: 1.5,
            speed: 1.0,
            description: "A mythic basic petal with otherworldly power",
            color: "#4B0082",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="16" ry="12" fill="#4B0082" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="14" ry="10" fill="#6A0DAD" opacity="0.8"/>
                <ellipse cx="16" cy="16" rx="12" ry="8" fill="#8A2BE2" opacity="0.6"/>
                <ellipse cx="16" cy="16" rx="10" ry="6" fill="#9370DB" opacity="0.4"/>
                <ellipse cx="16" cy="16" rx="8" ry="4" fill="#DDA0DD" opacity="0.2"/>
                <ellipse cx="16" cy="16" rx="6" ry="2" fill="#FFD700" opacity="0.3"/>
            </svg>`
        }
    },
    rose: {
        common: {
            name: "Rose Petal",
            damage: 8,
            health: 8,
            size: 0.9,
            speed: 1.2,
            description: "A thorny petal that deals extra damage",
            color: "#FF69B4",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="11" ry="7" fill="#FF69B4" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="9" ry="5" fill="#FFB6C1" opacity="0.7"/>
                <path d="M16 8 L18 12 L22 10 L20 14 L24 16 L20 18 L22 22 L18 20 L16 24 L14 20 L10 22 L12 18 L8 16 L12 14 L10 10 L14 12 Z" fill="#FF1493" opacity="0.5"/>
            </svg>`
        },
        uncommon: {
            name: "Blood Rose Petal",
            damage: 12,
            health: 12,
            size: 1.0,
            speed: 1.2,
            description: "A crimson petal with sharp thorns",
            color: "#DC143C",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="12" ry="8" fill="#DC143C" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="10" ry="6" fill="#FF6347" opacity="0.7"/>
                <path d="M16 8 L18 12 L22 10 L20 14 L24 16 L20 18 L22 22 L18 20 L16 24 L14 20 L10 22 L12 18 L8 16 L12 14 L10 10 L14 12 Z" fill="#8B0000" opacity="0.6"/>
                <circle cx="12" cy="12" r="1" fill="#000"/>
                <circle cx="20" cy="12" r="1" fill="#000"/>
            </svg>`
        },
        rare: {
            name: "Royal Rose Petal",
            damage: 18,
            health: 18,
            size: 1.1,
            speed: 1.2,
            description: "A majestic rose petal fit for royalty",
            color: "#8B0000",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="13" ry="9" fill="#8B0000" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="11" ry="7" fill="#DC143C" opacity="0.8"/>
                <ellipse cx="16" cy="16" rx="9" ry="5" fill="#FF6347" opacity="0.6"/>
                <path d="M16 8 L18 12 L22 10 L20 14 L24 16 L20 18 L22 22 L18 20 L16 24 L14 20 L10 22 L12 18 L8 16 L12 14 L10 10 L14 12 Z" fill="#FFD700" opacity="0.4"/>
                <circle cx="12" cy="12" r="1" fill="#FFD700"/>
                <circle cx="20" cy="12" r="1" fill="#FFD700"/>
            </svg>`
        },
        epic: {
            name: "Divine Rose Petal",
            damage: 26,
            health: 26,
            size: 1.2,
            speed: 1.2,
            description: "A divine rose petal blessed with power",
            color: "#B22222",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="14" ry="10" fill="#B22222" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="12" ry="8" fill="#8B0000" opacity="0.8"/>
                <ellipse cx="16" cy="16" rx="10" ry="6" fill="#DC143C" opacity="0.6"/>
                <ellipse cx="16" cy="16" rx="8" ry="4" fill="#FF6347" opacity="0.4"/>
                <path d="M16 8 L18 12 L22 10 L20 14 L24 16 L20 18 L22 22 L18 20 L16 24 L14 20 L10 22 L12 18 L8 16 L12 14 L10 10 L14 12 Z" fill="#FFD700" opacity="0.5"/>
                <circle cx="12" cy="12" r="1" fill="#FFD700"/>
                <circle cx="20" cy="12" r="1" fill="#FFD700"/>
                <circle cx="16" cy="8" r="1" fill="#FFD700"/>
            </svg>`
        },
        legendary: {
            name: "Eternal Rose Petal",
            damage: 38,
            health: 38,
            size: 1.3,
            speed: 1.2,
            description: "An eternal rose petal that never wilts",
            color: "#FF1493",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="15" ry="11" fill="#FF1493" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="13" ry="9" fill="#B22222" opacity="0.8"/>
                <ellipse cx="16" cy="16" rx="11" ry="7" fill="#8B0000" opacity="0.6"/>
                <ellipse cx="16" cy="16" rx="9" ry="5" fill="#DC143C" opacity="0.4"/>
                <path d="M16 8 L18 12 L22 10 L20 14 L24 16 L20 18 L22 22 L18 20 L16 24 L14 20 L10 22 L12 18 L8 16 L12 14 L10 10 L14 12 Z" fill="#FFD700" opacity="0.6"/>
                <circle cx="12" cy="12" r="1" fill="#FFD700"/>
                <circle cx="20" cy="12" r="1" fill="#FFD700"/>
                <circle cx="16" cy="8" r="1" fill="#FFD700"/>
                <circle cx="10" cy="16" r="1" fill="#FFD700"/>
                <circle cx="22" cy="16" r="1" fill="#FFD700"/>
            </svg>`
        },
        mythic: {
            name: "Celestial Rose Petal",
            damage: 55,
            health: 55,
            size: 1.4,
            speed: 1.2,
            description: "A celestial rose petal from the heavens",
            color: "#FF6347",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="16" ry="12" fill="#FF6347" stroke="#000" stroke-width="1"/>
                <ellipse cx="16" cy="16" rx="14" ry="10" fill="#FF1493" opacity="0.8"/>
                <ellipse cx="16" cy="16" rx="12" ry="8" fill="#B22222" opacity="0.6"/>
                <ellipse cx="16" cy="16" rx="10" ry="6" fill="#8B0000" opacity="0.4"/>
                <path d="M16 8 L18 12 L22 10 L20 14 L24 16 L20 18 L22 22 L18 20 L16 24 L14 20 L10 22 L12 18 L8 16 L12 14 L10 10 L14 12 Z" fill="#FFD700" opacity="0.7"/>
                <circle cx="12" cy="12" r="1" fill="#FFD700"/>
                <circle cx="20" cy="12" r="1" fill="#FFD700"/>
                <circle cx="16" cy="8" r="1" fill="#FFD700"/>
                <circle cx="10" cy="16" r="1" fill="#FFD700"/>
                <circle cx="22" cy="16" r="1" fill="#FFD700"/>
                <circle cx="16" cy="24" r="1" fill="#FFD700"/>
                <circle cx="8" cy="8" r="0.5" fill="#FFD700"/>
                <circle cx="24" cy="8" r="0.5" fill="#FFD700"/>
                <circle cx="8" cy="24" r="0.5" fill="#FFD700"/>
                <circle cx="24" cy="24" r="0.5" fill="#FFD700"/>
            </svg>`
        }
    },
    stinger: {
        common: {
            name: "Stinger",
            damage: 12,
            health: 5,
            size: 0.8,
            speed: 1.5,
            description: "A fast, sharp petal that prioritizes offense",
            color: "#FFD700",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="10" ry="6" fill="#FFD700" stroke="#000" stroke-width="1"/>
                <path d="M16 8 L20 12 L24 8 L20 16 L28 16 L20 20 L24 24 L20 20 L16 24 L12 20 L8 24 L12 20 L4 16 L12 16 L8 12 L12 8 Z" fill="#FFA500" opacity="0.7"/>
            </svg>`
        },
        uncommon: {
            name: "Venomous Stinger",
            damage: 18,
            health: 7,
            size: 0.85,
            speed: 1.5,
            description: "A poisonous stinger with deadly precision",
            color: "#FFA500",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="11" ry="7" fill="#FFA500" stroke="#000" stroke-width="1"/>
                <path d="M16 8 L20 12 L24 8 L20 16 L28 16 L20 20 L24 24 L20 20 L16 24 L12 20 L8 24 L12 20 L4 16 L12 16 L8 12 L12 8 Z" fill="#FF8C00" opacity="0.8"/>
                <circle cx="14" cy="14" r="1" fill="#8B0000"/>
                <circle cx="18" cy="14" r="1" fill="#8B0000"/>
            </svg>`
        },
        rare: {
            name: "Barbed Stinger",
            damage: 26,
            health: 10,
            size: 0.9,
            speed: 1.5,
            description: "A barbed stinger that tears through enemies",
            color: "#FF8C00",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="12" ry="8" fill="#FF8C00" stroke="#000" stroke-width="1"/>
                <path d="M16 8 L20 12 L24 8 L20 16 L28 16 L20 20 L24 24 L20 20 L16 24 L12 20 L8 24 L12 20 L4 16 L12 16 L8 12 L12 8 Z" fill="#FF7F50" opacity="0.8"/>
                <circle cx="14" cy="14" r="1" fill="#8B0000"/>
                <circle cx="18" cy="14" r="1" fill="#8B0000"/>
                <circle cx="16" cy="12" r="0.5" fill="#8B0000"/>
                <circle cx="16" cy="20" r="0.5" fill="#8B0000"/>
            </svg>`
        },
        epic: {
            name: "Razor Stinger",
            damage: 38,
            health: 14,
            size: 0.95,
            speed: 1.5,
            description: "A razor-sharp stinger of incredible lethality",
            color: "#FF7F50",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="13" ry="9" fill="#FF7F50" stroke="#000" stroke-width="1"/>
                <path d="M16 8 L20 12 L24 8 L20 16 L28 16 L20 20 L24 24 L20 20 L16 24 L12 20 L8 24 L12 20 L4 16 L12 16 L8 12 L12 8 Z" fill="#FF4500" opacity="0.8"/>
                <circle cx="14" cy="14" r="1" fill="#8B0000"/>
                <circle cx="18" cy="14" r="1" fill="#8B0000"/>
                <circle cx="16" cy="12" r="0.5" fill="#8B0000"/>
                <circle cx="16" cy="20" r="0.5" fill="#8B0000"/>
                <circle cx="12" cy="16" r="0.5" fill="#8B0000"/>
                <circle cx="20" cy="16" r="0.5" fill="#8B0000"/>
            </svg>`
        },
        legendary: {
            name: "Infernal Stinger",
            damage: 55,
            health: 20,
            size: 1.0,
            speed: 1.5,
            description: "An infernal stinger wreathed in flames",
            color: "#FF4500",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="14" ry="10" fill="#FF4500" stroke="#000" stroke-width="1"/>
                <path d="M16 8 L20 12 L24 8 L20 16 L28 16 L20 20 L24 24 L20 20 L16 24 L12 20 L8 24 L12 20 L4 16 L12 16 L8 12 L12 8 Z" fill="#DC143C" opacity="0.8"/>
                <circle cx="14" cy="14" r="1" fill="#8B0000"/>
                <circle cx="18" cy="14" r="1" fill="#8B0000"/>
                <circle cx="16" cy="12" r="0.5" fill="#8B0000"/>
                <circle cx="16" cy="20" r="0.5" fill="#8B0000"/>
                <circle cx="12" cy="16" r="0.5" fill="#8B0000"/>
                <circle cx="20" cy="16" r="0.5" fill="#8B0000"/>
                <circle cx="16" cy="8" r="0.3" fill="#FFD700"/>
                <circle cx="16" cy="24" r="0.3" fill="#FFD700"/>
            </svg>`
        },
        mythic: {
            name: "Void Stinger",
            damage: 80,
            health: 28,
            size: 1.1,
            speed: 1.5,
            description: "A void stinger that pierces reality itself",
            color: "#800080",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="16" rx="15" ry="11" fill="#800080" stroke="#000" stroke-width="1"/>
                <path d="M16 8 L20 12 L24 8 L20 16 L28 16 L20 20 L24 24 L20 20 L16 24 L12 20 L8 24 L12 20 L4 16 L12 16 L8 12 L12 8 Z" fill="#4B0082" opacity="0.8"/>
                <circle cx="14" cy="14" r="1" fill="#8B0000"/>
                <circle cx="18" cy="14" r="1" fill="#8B0000"/>
                <circle cx="16" cy="12" r="0.5" fill="#8B0000"/>
                <circle cx="16" cy="20" r="0.5" fill="#8B0000"/>
                <circle cx="12" cy="16" r="0.5" fill="#8B0000"/>
                <circle cx="20" cy="16" r="0.5" fill="#8B0000"/>
                <circle cx="16" cy="8" r="0.3" fill="#FFD700"/>
                <circle cx="16" cy="24" r="0.3" fill="#FFD700"/>
                <circle cx="8" cy="8" r="0.2" fill="#FFD700"/>
                <circle cx="24" cy="8" r="0.2" fill="#FFD700"/>
                <circle cx="8" cy="24" r="0.2" fill="#FFD700"/>
                <circle cx="24" cy="24" r="0.2" fill="#FFD700"/>
            </svg>`
        }
    }
};

export function getPetalStats(petalType: string, rarity: string): PetalStats | null {
    return PETAL_CONFIG[petalType]?.[rarity] || null;
}

export function getAllPetalTypes(): string[] {
    return Object.keys(PETAL_CONFIG);
}

export function getPetalRarities(petalType: string): string[] {
    return Object.keys(PETAL_CONFIG[petalType] || {});
}
