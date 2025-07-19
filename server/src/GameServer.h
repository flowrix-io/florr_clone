#pragma once

#include <memory>
#include <map>
#include <vector>
#include <string>
#include <random>
#include <chrono>
#include <mutex>

#include <nlohmann/json.hpp>

#include "Player.h"
#include "Mob.h"
#include "Vector2.h"
#include "PetalManager.h"

using json = nlohmann::json;

class GameServer {
public:
    GameServer();
    ~GameServer();

    // Player management
    std::shared_ptr<Player> addPlayer(const std::string& playerId);
    void removePlayer(const std::string& playerId);
    void updatePlayer(const std::string& playerId, const json& data);
    void updatePlayerMousePosition(const std::string& playerId, float mouseX, float mouseY);
    void updatePlayerCanvasDimensions(const std::string& playerId, float width, float height);
    std::shared_ptr<Player> getPlayer(const std::string& playerId);

    // Mob management
    void spawnMob();
    bool damageMob(const std::string& mobId, int damage);
    void removeMob(const std::string& mobId);

    // Game loop
    void update();

    // Serialization
    json getGameState() const;
    json getPlayersJson() const;
    json getMobsJson() const;

private:
    void updateMobs();
    void updatePlayers();
    void checkCollisions();
    void handleMobSpawning();
    
    Vector2 getRandomSpawnPosition();
    MobType getRandomMobType();
    std::string generateMobId();

    std::map<std::string, std::shared_ptr<Player>> m_players;
    std::map<std::string, std::shared_ptr<Mob>> m_mobs;
    PetalManager m_petalManager;
    
    std::chrono::steady_clock::time_point m_lastMobSpawnTime;
    long long m_nextMobId;
    mutable std::mutex m_mutex;
    // Game settings
    static constexpr int WORLD_WIDTH = 2000;
    static constexpr int WORLD_HEIGHT = 2000;
    static constexpr int MAX_MOBS = 20;
    static constexpr float MOB_SPAWN_RATE = 0.1f; // mobs per second
    
    // Random number generation
    std::random_device m_rd;
    std::mt19937 m_gen;
    std::uniform_real_distribution<float> m_worldXDist;
    std::uniform_real_distribution<float> m_worldYDist;
    std::uniform_int_distribution<int> m_mobTypeDist;
    
}; 