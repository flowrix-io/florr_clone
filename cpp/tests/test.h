#pragma once
// A minimal assertion harness. Tests are plain functions registered with
// TEST(); main() runs them all and reports every failure rather than aborting
// on the first, so one broken invariant does not hide the next.

#include <cmath>
#include <type_traits>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace testing {

struct Case {
    const char* name;
    std::function<void()> fn;
};

inline std::vector<Case>& cases() {
    static std::vector<Case> c;
    return c;
}

inline int& failures() {
    static int f = 0;
    return f;
}

inline std::string& currentCase() {
    static std::string s;
    return s;
}

inline void reportFailure(const char* file, int line, const std::string& what) {
    ++failures();
    std::printf("  FAIL %s\n    %s:%d: %s\n", currentCase().c_str(), file, line, what.c_str());
}

struct Registrar {
    Registrar(const char* name, std::function<void()> fn) { cases().push_back({name, std::move(fn)}); }
};

inline int runAll() {
    int failed = 0;
    for (auto& c : cases()) {
        currentCase() = c.name;
        const int before = failures();
        c.fn();
        if (failures() > before) ++failed;
    }
    std::printf("\n%zu tests, %d failed, %d assertion failures\n", cases().size(), failed, failures());
    return failures() == 0 ? 0 : 1;
}

} // namespace testing

#define TEST(name)                                                             \
    static void name();                                                        \
    static ::testing::Registrar registrar_##name(#name, name);                 \
    static void name()

#define CHECK(cond)                                                            \
    do {                                                                       \
        if (!(cond)) ::testing::reportFailure(__FILE__, __LINE__, "CHECK(" #cond ")"); \
    } while (0)

#define CHECK_EQ(a, b)                                                         \
    do {                                                                       \
        auto va_ = (a);                                                        \
        auto vb_ = (b);                                                        \
        if (!(va_ == vb_))                                                     \
            ::testing::reportFailure(__FILE__, __LINE__,                       \
                std::string("CHECK_EQ(" #a ", " #b ") -> ") +                  \
                ::testing::show(va_) + " != " + ::testing::show(vb_));         \
    } while (0)

#define CHECK_NEAR(a, b, tol)                                                  \
    do {                                                                       \
        const double va_ = static_cast<double>(a);                             \
        const double vb_ = static_cast<double>(b);                             \
        if (!(std::fabs(va_ - vb_) <= (tol)))                                  \
            ::testing::reportFailure(__FILE__, __LINE__,                       \
                std::string("CHECK_NEAR(" #a ", " #b ") -> ") +                \
                std::to_string(va_) + " vs " + std::to_string(vb_));           \
    } while (0)

namespace testing {
inline std::string show(const std::string& v) { return "\"" + v + "\""; }
inline std::string show(const char* v) { return std::string("\"") + v + "\""; }
inline std::string show(bool v) { return v ? "true" : "false"; }
template <class T>
inline std::string show(T v) {
    // Scoped enums have no to_string; print the underlying value so a failed
    // comparison still names which two tiers disagreed.
    if constexpr (std::is_enum_v<T>) {
        return std::to_string(static_cast<long long>(v));
    } else {
        return std::to_string(v);
    }
}
} // namespace testing
