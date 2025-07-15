#include "Mob.h"
#include <iostream>

Mob::Mob(const std::string& id, MobType type) 
    : m_id(id)
    , m_position(0, 0)
    , m_velocity(0, 0)
    , m_health(50)
    , m_maxHealth(50)
    , m_radius(15.0f)
    , m_speed(80.0f)
    , m_type(type)
    , m_target("")
{
    initializeMobProperties();
}

Mob::~Mob() {
    // Destructor
}

void Mob::initializeMobProperties() {
    // Set different properties based on mob type
    switch (m_type) {
        case MobType::BIRD:
            m_health = 30;
            m_maxHealth = 30;
            m_radius = 12.0f;
            m_speed = 120.0f;
            break;
        case MobType::BEE:
            m_health = 20;
            m_maxHealth = 20;
            m_radius = 10.0f;
            m_speed = 150.0f;
            break;
        case MobType::CAT:
            m_health = 80;
            m_maxHealth = 80;
            m_radius = 18.0f;
            m_speed = 100.0f;
            break;
        case MobType::MOUSE:
            m_health = 15;
            m_maxHealth = 15;
            m_radius = 8.0f;
            m_speed = 180.0f;
            break;
    }
}

void Mob::takeDamage(int damage) {
    m_health = std::max(0, m_health - damage);
    if (m_health <= 0) {
        std::cout << "Mob " << m_id << " (" << mobTypeToString(m_type) << ") has died!" << std::endl;
    }
}

void Mob::heal(int amount) {
    m_health = std::min(m_maxHealth, m_health + amount);
}

json Mob::toJson() const {
    json mobJson;
    mobJson["id"] = m_id;
    mobJson["position"]["x"] = m_position.x;
    mobJson["position"]["y"] = m_position.y;
    mobJson["velocity"]["x"] = m_velocity.x;
    mobJson["velocity"]["y"] = m_velocity.y;
    mobJson["health"] = m_health;
    mobJson["maxHealth"] = m_maxHealth;
    mobJson["radius"] = m_radius;
    mobJson["type"] = mobTypeToString(m_type);
    mobJson["target"] = m_target;
    
    return mobJson;
}

void Mob::fromJson(const json& data) {
    if (data.contains("position")) {
        m_position.x = data["position"]["x"];
        m_position.y = data["position"]["y"];
    }
    
    if (data.contains("velocity")) {
        m_velocity.x = data["velocity"]["x"];
        m_velocity.y = data["velocity"]["y"];
    }
    
    if (data.contains("health")) {
        m_health = data["health"];
    }
    
    if (data.contains("maxHealth")) {
        m_maxHealth = data["maxHealth"];
    }
    
    if (data.contains("radius")) {
        m_radius = data["radius"];
    }
    
    if (data.contains("type")) {
        m_type = stringToMobType(data["type"]);
    }
    
    if (data.contains("target")) {
        m_target = data["target"];
    }
}

std::string Mob::mobTypeToString(MobType type) {
    switch (type) {
        case MobType::BIRD:
            return "bird";
        case MobType::BEE:
            return "bee";
        case MobType::CAT:
            return "cat";
        case MobType::MOUSE:
            return "mouse";
        default:
            return "unknown";
    }
}

MobType Mob::stringToMobType(const std::string& typeStr) {
    if (typeStr == "bird") {
        return MobType::BIRD;
    } else if (typeStr == "bee") {
        return MobType::BEE;
    } else if (typeStr == "cat") {
        return MobType::CAT;
    } else if (typeStr == "mouse") {
        return MobType::MOUSE;
    } else {
        return MobType::BIRD; // Default fallback
    }
} 