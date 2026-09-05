#pragma once
// Password and token cryptography, with no library behind it.
//
// bcrypt here is not an implementation detail we are free to get subtly wrong.
// Every existing account's password was hashed by the Node `bcrypt` library,
// so verify() has to reproduce that library's output byte for byte or the
// entire player base is locked out on the day this server replaces the old
// one. That is why the EksBlowfish key schedule, the 72-byte key cap and
// bcrypt's own base64 alphabet are reproduced exactly, and why the tests pin
// published known-answer vectors instead of only round-tripping our own
// output -- a self-consistent wrong implementation passes a round-trip test.

#include <cstddef>
#include <cstdint>
#include <string>

namespace flix::crypto {

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

/// Streaming SHA-256. Used for session token hashing, which is the only place
/// the server needs a plain digest.
class Sha256 {
public:
    Sha256() { reset(); }
    void reset();
    void update(const void* data, std::size_t length);
    void update(const std::string& data) { update(data.data(), data.size()); }
    /// Writes the digest and leaves the object unusable until reset().
    void finish(std::uint8_t out[32]);

private:
    void compress(const std::uint8_t block[64]);

    std::uint32_t state_[8];
    std::uint8_t buffer_[64];
    std::size_t buffered_ = 0;
    std::uint64_t totalBits_ = 0;
};

void sha256(const void* data, std::size_t length, std::uint8_t out[32]);

/// Lowercase hex, matching Node's `createHash('sha256').digest('hex')` -- the
/// session table in an existing inventory.json is keyed by exactly this.
std::string sha256Hex(const std::string& data);

std::string toHex(const std::uint8_t* bytes, std::size_t length);

// ---------------------------------------------------------------------------
// bcrypt
// ---------------------------------------------------------------------------

/// OpenBSD's cost bounds. A cost is a log2 iteration count, so 31 is not a
/// number anyone survives typing by accident -- it is hours per verify.
inline constexpr int kBcryptMinCost = 4;
inline constexpr int kBcryptMaxCost = 31;

/// New hashes are written at this cost. Matches what the old server used, so
/// re-hashing on login is never needed for an account it created.
inline constexpr int kBcryptDefaultCost = 12;

/// bcrypt ignores everything past the 72nd byte of a password. Callers should
/// reject longer passwords outright rather than silently accepting a prefix.
inline constexpr std::size_t kBcryptMaxPasswordBytes = 72;

/// Hashes `password` with a fresh random salt. Returns a 60-character
/// `$2b$NN$...` string, or an empty string if `cost` is out of range.
std::string bcryptHash(const std::string& password, int cost = kBcryptDefaultCost);

/// Hashes `password` under the salt and cost encoded in `setting` (any prefix
/// of a hash string through its 22 salt characters). Returns the full hash
/// string, or empty if `setting` is malformed. Exposed so tests can assert an
/// exact match against a published vector, which is a far stronger check than
/// verify() returning true.
std::string bcryptHashWithSetting(const std::string& password, const std::string& setting);

/// True when `password` produced `stored`. Accepts `$2a$`, `$2b$` and `$2y$`;
/// those three agree for every key we can be handed, since we cap the key at
/// 72 bytes exactly as `$2b$` does. `$2x$` -- the sign-extension bug variant --
/// is deliberately refused rather than emulated. Malformed input returns
/// false; nothing here throws.
bool bcryptVerify(const std::string& password, const std::string& stored);

/// True when `stored` has the shape of a bcrypt hash. The old server tested
/// `startsWith('$2b$')` and so treated every `$2a$` hash as an unmigrated
/// plaintext password; that is a bug, not a behaviour to carry across.
bool isBcryptHash(const std::string& stored);

/// The cost encoded in a hash string, or -1 if it is not a bcrypt hash.
int bcryptCost(const std::string& stored);

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/// A ChaCha20 CSPRNG seeded from /dev/urandom, with fast key erasure: every
/// refill overwrites its own key from the keystream, so capturing the state
/// reveals nothing that was generated before it.
///
/// Distinct from `flix::Rng` on purpose. That one is xoshiro, seeded from a
/// fixed number so the world generates identically on every machine -- exactly
/// the property that makes it unusable for a session token.
class SecureRandom {
public:
    SecureRandom();

    void bytes(void* out, std::size_t length);
    std::string hex(std::size_t byteCount);

    /// False if /dev/urandom could not be read and the seed fell back to
    /// process entropy. Tokens are then only as unpredictable as the clock,
    /// which is not enough -- a server seeing this should refuse to serve
    /// rather than hand out guessable sessions.
    bool seededFromKernel() const { return kernelSeeded_; }

private:
    void refill();

    std::uint8_t key_[32]{};
    std::uint64_t counter_ = 0;
    std::uint8_t buffer_[192]{};
    std::size_t offset_ = sizeof(buffer_);
    bool kernelSeeded_ = false;
};

/// The process-wide token source.
SecureRandom& secureRandom();

/// Compares without an early exit, so the time taken does not reveal how many
/// leading bytes of a guessed token or hash were correct.
bool constantTimeEquals(const std::string& a, const std::string& b);

} // namespace flix::crypto
