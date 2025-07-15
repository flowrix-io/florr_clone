#pragma once

#include <string>
#include <vector>
#include <nlohmann/json.hpp>
#include "Vector2.h"

using json = nlohmann::json;

struct OrbitingCircle {
    float angle = 0.0f;
    float radius = 8.0f;
    float orbitRadius = 60.0f;
    std::string color = "#ffffff";
    
    OrbitingCircle(float a, float r, float or_, const std::string& c) 
        : angle(a), radius(r), orbitRadius(or_), color(c) {}
};

class Player {
public:
    Player(const std::string& id);
    ~Player();

    // Getters
    const std::string& getId() const { return m_id; }
    const Vector2& getPosition() const { return m_position; }
    const Vector2& getVelocity() const { return m_velocity; }
    int getHealth() const { return m_health; }
    int getMaxHealth() const { return m_maxHealth; }
    float getRadius() const { return m_radius; }
    const std::string& getColor() const { return m_color; }
    const std::vector<OrbitingCircle>& getOrbitingCircles() const { return m_orbitingCircles; }

    // Setters
    void setPosition(const Vector2& position) { m_position = position; }
    void setVelocity(const Vector2& velocity) { m_velocity = velocity; }
    void setHealth(int health) { m_health = std::max(0, std::min(health, m_maxHealth)); }
    void setColor(const std::string& color) { m_color = color; }
    void setMousePosition(float mouseX, float mouseY) { m_mouseX = mouseX; m_mouseY = mouseY; }
    void setCanvasDimensions(float width, float height) { m_canvasWidth = width; m_canvasHeight = height; }
    float getCanvasWidth() const { return m_canvasWidth; }
    float getCanvasHeight() const { return m_canvasHeight; }

    // Actions
    void takeDamage(int damage);
    void heal(int amount);
    void updateOrbitingCircles(float deltaTime);
    void updateMovement(float deltaTime, const Vector2& worldBounds);
    bool isDead() const { return m_health <= 0; }

    // Serialization
    json toJson() const;
    void fromJson(const json& data);

private:
    void initializeOrbitingCircles();

    std::string m_id;
    Vector2 m_position;
    Vector2 m_velocity;
    int m_health;
    int m_maxHealth;
    float m_radius;
    std::string m_color;
    std::vector<OrbitingCircle> m_orbitingCircles;
    float m_mouseX = 0.0f;
    float m_mouseY = 0.0f;
    float m_canvasWidth = 1200.0f;
    float m_canvasHeight = 800.0f;
}; 