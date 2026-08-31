#include "test.h"

#include "server/crypto.h"

#include <string>

using namespace flr::crypto;

// The hashes below were produced by the Node `bcrypt` package the previous
// server used. They are the shape every existing account is stored in, so if
// these stop verifying, every player is locked out of their account. Treat a
// failure here as a release blocker, not a test to adjust.

TEST(sha256_matches_the_published_vectors) {
    CHECK_EQ(sha256Hex("abc"),
             std::string("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    CHECK_EQ(sha256Hex(""),
             std::string("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
    CHECK_EQ(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
             std::string("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"));
    // A long input crosses several compression blocks.
    CHECK_EQ(sha256Hex(std::string(1000, 'a')).size(), std::size_t(64));
}

TEST(bcrypt_verifies_the_openbsd_reference_vectors) {
    struct Vector { const char* password; const char* hash; };
    static const Vector kVectors[] = {
        {"U*U",   "$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW"},
        {"U*U*",  "$2a$05$CCCCCCCCCCCCCCCCCCCCC.VGOzA784oUp/Z0DY336zx7pLYAy0lwK"},
        {"U*U*U", "$2a$05$XXXXXXXXXXXXXXXXXXXXXOAcXxm9kjPGEMsLznoKqmqw7tc8WCx4a"},
        {"",      "$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s."},
        {"a",     "$2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe"},
        {"abc",   "$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i"},
        {"abcdefghijklmnopqrstuvwxyz",
                  "$2a$06$.rCVZVOThsIa97pEDOxvGuRRgzG64bvtJ0938xuqzv18d3ZpQhstC"},
        {"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
         "0123456789chars after 72 are ignored",
                  "$2a$05$abcdefghijklmnopqrstuu5s2v8.iXieOjg/.AySBTTZIIVFJeBui"},
    };
    for (const Vector& v : kVectors) {
        CHECK(bcryptVerify(v.password, v.hash));
        // Only meaningful under 72 bytes; see the truncation test below.
        if (std::string(v.password).size() < 72) {
            CHECK(!bcryptVerify(std::string(v.password) + "x", v.hash));
        }
    }
}

TEST(bcrypt_verifies_hashes_written_by_the_previous_server) {
    struct Vector { const char* password; const char* hash; };
    static const Vector kNodeHashes[] = {
        {"hunter2", "$2b$10$rzSCxDNoOpZCvoqIOV9COeDf72b.2.BrFKB.nglQgpG1r6knpj32m"},
        {"correct horse battery staple",
                    "$2b$12$2XTXtpXNuMonJ9HX442GYeByWDfnKcgsxGWvOK.v7LBQcqAzNhmqu"},
        {"",        "$2b$06$hASbkoQ3rD3hQkQcfbNsNOwChtOy6RcMRyk7pLbohW20XUeR9PLFK"},
        {"abc",     "$2b$06$4Eix7LHcCIn5TBNAaBnAM.99NVdWtMSrRzq0RJl7U.M4ihqyl/8oG"},
        // Non-ASCII passwords are bytes to bcrypt; a UTF-8 name must round trip.
        {"p\xC3\xA4ssw\xC3\xB6rd-\xC3\xBCnicode",
                    "$2b$10$LgOqq5NudTY8bqac/84fYe26LLJdzBt7gelslc5V8heUcRZOSwqkW"},
        {"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
         "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                    "$2b$08$D0XcL8AvqneGA1cYdSS4nuZXQ93OIQ4cbAA9hGnG9wowGkWmQMUSG"},
    };
    for (const Vector& v : kNodeHashes) {
        CHECK(bcryptVerify(v.password, v.hash));
        if (std::string(v.password).size() < 72) {
            CHECK(!bcryptVerify(std::string(v.password) + "!", v.hash));
        }
    }
}

TEST(bcrypt_ignores_bytes_past_seventy_two) {
    // Documented bcrypt behaviour, and the reason the password length cap in
    // session.cpp exists -- it is a work limit, not a strength rule.
    const std::string base(72, 'a');
    const std::string hash = bcryptHash(base, 6);
    CHECK(bcryptVerify(base + "these bytes are ignored", hash));
    CHECK(!bcryptVerify(std::string(71, 'a') + "b", hash));
}

TEST(fresh_hashes_round_trip_and_use_a_random_salt) {
    const std::string hash = bcryptHash("correct horse battery staple", 6);
    CHECK_EQ(hash.size(), std::size_t(60));
    CHECK_EQ(hash.compare(0, 4, "$2b$"), 0);
    CHECK_EQ(bcryptCost(hash), 6);
    CHECK(bcryptVerify("correct horse battery staple", hash));
    CHECK(!bcryptVerify("wrong", hash));
    CHECK(!bcryptVerify("", hash));

    // Two hashes of the same password must differ, or the salt is not random
    // and the whole database is rainbow-table-able.
    CHECK(bcryptHash("same", 6) != bcryptHash("same", 6));
}

TEST(malformed_hashes_are_refused_rather_than_crashing) {
    CHECK(!bcryptVerify("x", ""));
    CHECK(!bcryptVerify("x", "not-a-hash"));
    CHECK(!bcryptVerify("x", "$2a$05$tooshort"));
    CHECK(!bcryptVerify("x", "$2z$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW"));
    CHECK(!bcryptVerify("x", "$2a$99$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW"));
    CHECK(!bcryptVerify("x", std::string(500, '$')));

    CHECK(!isBcryptHash("plaintextpassword"));
    CHECK(!isBcryptHash(""));
    CHECK(isBcryptHash("$2b$10$rzSCxDNoOpZCvoqIOV9COeDf72b.2.BrFKB.nglQgpG1r6knpj32m"));
}

TEST(constant_time_compare_still_compares) {
    CHECK(constantTimeEquals("abcdef", "abcdef"));
    CHECK(!constantTimeEquals("abcdef", "abcdeg"));
    CHECK(!constantTimeEquals("abcdef", "abcde"));
    CHECK(!constantTimeEquals("", "a"));
    CHECK(constantTimeEquals("", ""));
}

TEST(secure_random_produces_distinct_unpredictable_tokens) {
    // A session token stands in for a password for thirty days, so this must
    // be seeded from the kernel, not from the clock.
    CHECK(secureRandom().seededFromKernel());

    const std::string a = secureRandom().hex(32);
    const std::string b = secureRandom().hex(32);
    CHECK_EQ(a.size(), std::size_t(64));
    CHECK_EQ(b.size(), std::size_t(64));
    CHECK(a != b);
    // Tokens are stored in and read back out of JSON, so they must be plain
    // printable text with nothing needing escaping.
    for (const char c : a) {
        CHECK((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));
    }

    // Raw bytes must not be stuck at a constant either -- a broken refill
    // would still produce "distinct" hex from a counter alone.
    std::uint8_t buffer[64] = {0};
    secureRandom().bytes(buffer, sizeof buffer);
    int nonZero = 0;
    for (const std::uint8_t byte : buffer) if (byte != 0) ++nonZero;
    CHECK(nonZero > 50);
}
