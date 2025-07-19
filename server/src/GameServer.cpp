#include "GameServer.h"
#include <iostream>
#include <chrono>
#include <cmath>
#include <limits>
#include <algorithm>

GameServer::GameServer() 
    : m_gen(m_rd())
    , m_worldXDist(0.0f, static_cast<float>(WORLD_WIDTH))
    , m_worldYDist(0.0f, static_cast<float>(WORLD_HEIGHT))
    , m_mobTypeDist(0, 3) // 4 mob types
    , m_lastMobSpawnTime(std::chrono::steady_clock::now())
    , m_nextMobId(1)
{
    std::cout << "GameServer initialized" << std::endl;
    m_petalManager.loadPetals("../data/petals");
}

GameServer::~GameServer() {
    std::cout << "GameServer destroyed" << std::endl;
}

std::shared_ptr<Player> GameServer::addPlayer(const std::string& playerId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto player = std::make_shared<Player>(playerId);
    
    // Set random spawn position
    Vector2 spawnPos = getRandomSpawnPosition();
    player->setPosition(spawnPos);

    const Petal* basicPetal = m_petalManager.getPetal("basic");
    if (basicPetal) {
        player->addPetal(*basicPetal);
    }
    
    m_players[playerId] = player;
    
    std::cout << "Player " << playerId << " joined at (" 
              << spawnPos.x << ", " << spawnPos.y << ")" << std::endl;
    
    return player;
}

void GameServer::removePlayer(const std::string& playerId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_players.erase(playerId);
}

void GameServer::updatePlayer(const std::string& playerId, const json& data) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_players.find(playerId);
    if (it != m_players.end()) {
        auto player = it->second;
        
        // Update player position
        if (data.contains("position")) {
            Vector2 newPos;
            newPos.x = data["position"]["x"];
            newPos.y = data["position"]["y"];
            player->setPosition(newPos);
        }
        
        // Update player health
        if (data.contains("health")) {
            int health = data["health"];
            player->setHealth(health);
        }
        if (data.contains("mousePosition")) {
            float mouseX = data["mousePosition"]["x"];
            float mouseY = data["mousePosition"]["y"];
            player->setMousePosition(mouseX, mouseY);
        }
    }
}

void GameServer::updatePlayerMousePosition(const std::string& playerId, float mouseX, float mouseY) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_players.find(playerId);
    if (it != m_players.end()) {
        it->second->setMousePosition(mouseX, mouseY);
    }
}

void GameServer::updatePlayerCanvasDimensions(const std::string& playerId, float width, float height) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_players.find(playerId);
    if (it != m_players.end()) {
        it->second->setCanvasDimensions(width, height);
    }
}

std::shared_ptr<Player> GameServer::getPlayer(const std::string& playerId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_players.find(playerId);
    return (it != m_players.end()) ? it->second : nullptr;
}

void GameServer::spawnMob() {
    if (m_mobs.size() >= MAX_MOBS) {
        return;
    }
    
    std::string mobId = generateMobId();
    auto mob = std::make_shared<Mob>(mobId, getRandomMobType());
    
    // Set random spawn position
    Vector2 spawnPos = getRandomSpawnPosition();
    mob->setPosition(spawnPos);
    
    m_mobs[mobId] = mob;
    
    std::cout << "Mob " << mobId << " spawned at (" 
              << spawnPos.x << ", " << spawnPos.y << ")" << std::endl;
}

bool GameServer::damageMob(const std::string& mobId, int damage) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_mobs.find(mobId);
    if (it != m_mobs.end()) {
        auto mob = it->second;
        mob->takeDamage(damage);
        
        if (mob->isDead()) {
            std::cout << "Mob " << mobId << " destroyed" << std::endl;
            m_mobs.erase(it);
            return true; // Mob was destroyed
        }
    }
    return false; // Mob still alive or not found
}

void GameServer::removeMob(const std::string& mobId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_mobs.erase(mobId);
}

void GameServer::update() {
    std::lock_guard<std::mutex> lock(m_mutex);
    printf("update\n");
    // Correctly format the size_t from .size()
    printf("m_players.size(): %zu\n", m_players.size());
    updateMobs();
    updatePlayers();
    checkCollisions();
    handleMobSpawning();
}

void GameServer::updateMobs() {
    const float deltaTime = 0.016f; // ~60 FPS
    
    // Create a list of mobs to remove to avoid iterator invalidation
    std::vector<std::string> mobsToRemove;

    for (auto& [mobId, mob] : m_mobs) {
        // Find nearest player
        std::shared_ptr<Player> nearestPlayer = nullptr;
        float nearestDistance = std::numeric_limits<float>::max();
        
        for (auto& [playerId, player] : m_players) {
            Vector2 playerPos = player->getPosition();
            Vector2 mobPos = mob->getPosition();
            
            float distance = std::sqrt(
                (playerPos.x - mobPos.x) * (playerPos.x - mobPos.x) +
                (playerPos.y - mobPos.y) * (playerPos.y - mobPos.y)
            );
            
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestPlayer = player;
            }
        }
        
        // Move mob towards nearest player
        if (nearestPlayer) {
            Vector2 playerPos = nearestPlayer->getPosition();
            Vector2 mobPos = mob->getPosition();
            
            float dx = playerPos.x - mobPos.x;
            float dy = playerPos.y - mobPos.y;
            float distance = std::sqrt(dx * dx + dy * dy);
            
            if (distance > 0) {
                float speed = mob->getSpeed();
                Vector2 velocity;
                velocity.x = (dx / distance) * speed;
                velocity.y = (dy / distance) * speed;
                
                mob->setVelocity(velocity);
                
                // Update position
                Vector2 newPos;
                newPos.x = mobPos.x + velocity.x * deltaTime;
                newPos.y = mobPos.y + velocity.y * deltaTime;
                
                // Keep mob within bounds
                newPos.x = std::max(0.0f, std::min(static_cast<float>(WORLD_WIDTH), newPos.x));
                newPos.y = std::max(0.0f, std::min(static_cast<float>(WORLD_HEIGHT), newPos.y));
                
                mob->setPosition(newPos);
            }
        }
    }
}

void GameServer::updatePlayers() {
    const float deltaTime = 0.016f; // ~60 FPS
    Vector2 worldBounds(WORLD_WIDTH, WORLD_HEIGHT);
    printf("m_players.size(): %zu\n", m_players.size());
    
    for (auto& [playerId, player] : m_players) {
        // Update player movement based on mouse position
        player->updateMovement(deltaTime, worldBounds);
        printf("Player %s moved to (%f, %f)\n", playerId.c_str(), player->getPosition().x, player->getPosition().y);
        
        // Update orbiting circles
        player->updatePetals(deltaTime);
    }
}

void GameServer::checkCollisions() {
    // Collision detection is handled client-side for now
    // Server validates damage requests

    // Mob <-> Player Orbiting Circle Collisions
    for (auto& [mobId, mob] : m_mobs) {
        for (auto& [playerId, player] : m_players) {
            Vector2 mobPos = mob->getPosition();
            Vector2 playerPos = player->getPosition();

            float distance = std::sqrt(
                (mobPos.x - playerPos.x) * (mobPos.x - playerPos.x) +
                (mobPos.y - playerPos.y) * (mobPos.y - playerPos.y)
            );

            if (distance < mob->getRadius() + player->getRadius()) {
                // Apply damage to player
                player->takeDamage(1); // Simple damage for now
                std::cout << "Player " << playerId << " hit by Mob " << mobId << std::endl;
            }
        }
    }
}

void GameServer::handleMobSpawning() {
    // This is called by update(), which already has a lock. No need to lock here.
    auto now = std::chrono::steady_clock::now();
    auto diff = std::chrono::duration_cast<std::chrono::seconds>(now - m_lastMobSpawnTime).count();
    
    // Check if it's time to spawn a mob
    if (diff >= (1.0f / MOB_SPAWN_RATE)) {
        spawnMob();
        m_lastMobSpawnTime = now; // Update last spawn time ONLY after spawning
    }
}

Vector2 GameServer::getRandomSpawnPosition() {
    Vector2 pos;
    pos.x = m_worldXDist(m_gen);
    pos.y = m_worldYDist(m_gen);
    return pos;
}

MobType GameServer::getRandomMobType() {
    int type = m_mobTypeDist(m_gen);
    switch (type) {
        case 0: return MobType::BIRD;
        case 1: return MobType::BEE;
        case 2: return MobType::CAT;
        case 3: return MobType::MOUSE;
        default: return MobType::BIRD;
    }
}

std::string GameServer::generateMobId() {
    return "mob_" + std::to_string(m_nextMobId++);
}

json GameServer::getGameState() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    json state;
    state["players"] = getPlayersJson();
    state["mobs"] = getMobsJson();
    state["worldBounds"]["width"] = WORLD_WIDTH;
    state["worldBounds"]["height"] = WORLD_HEIGHT;
    return state;
}

json GameServer::getPlayersJson() const {
    json playersJson;
    for (const auto& [id, player] : m_players) {
        playersJson[id] = player->toJson();
    }
    return playersJson;
}

json GameServer::getMobsJson() const {
    json mobsJson;
    for (const auto& [id, mob] : m_mobs) {
        mobsJson[id] = mob->toJson();
    }
    return mobsJson;
} 