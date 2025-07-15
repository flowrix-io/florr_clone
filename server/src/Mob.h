#pragma once

#include <string>
#include <nlohmann/json.hpp>
#include "Vector2.h"

using json = nlohmann::json;

enum class MobType {
    BIRD,
    BEE,
    CAT,
    MOUSE
};

class Mob {
public:
    Mob(const std::string& id, MobType type);
    ~Mob();

    // Getters
    const std::string& getId() const { return m_id; }
    const Vector2& getPosition() const { return m_position; }
    const Vector2& getVelocity() const { return m_velocity; }
    int getHealth() const { return m_health; }
    int getMaxHealth() const { return m_maxHealth; }
    float getRadius() const { return m_radius; }
    float getSpeed() const { return m_speed; }
    MobType getType() const { return m_type; }
    const std::string& getTarget() const { return m_target; }

    // Setters
    void setPosition(const Vector2& position) { m_position = position; }
    void setVelocity(const Vector2& velocity) { m_velocity = velocity; }
    void setHealth(int health) { m_health = std::max(0, std::min(health, m_maxHealth)); }
    void setTarget(const std::string& target) { m_target = target; }

    // Actions
    void takeDamage(int damage);
    void heal(int amount);
    bool isDead() const { return m_health <= 0; }

    // Serialization
    json toJson() const;
    void fromJson(const json& data);

    // Static utilities
    static std::string mobTypeToString(MobType type);
    static MobType stringToMobType(const std::string& typeStr);

private:
    void initializeMobProperties();

    std::string m_id;
    Vector2 m_position;
    Vector2 m_velocity;
    int m_health;
    int m_maxHealth;
    float m_radius;
    float m_speed;
    MobType m_type;
    std::string m_target; // Player ID to target
}; 