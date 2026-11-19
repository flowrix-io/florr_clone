#pragma once

// What Window::setInputGuard turns on: the window's defence against input that
// a program, not a hand, produced.
//
// Two rules, both decided as each event arrives:
//
//   * A mouse that does not move like a mouse is not believed about where it
//     is. PointerPhysics, below, judges every sample the way a physical
//     pointer is bound to behave -- it cannot teleport, it takes time to get
//     anywhere, it wobbles -- and a sample it cannot vouch for is still
//     delivered (a press is still a press) but at a random point on the
//     canvas. Only that one sample: the next is judged afresh. A program can
//     then click, but it cannot aim. Whether the browser itself says it made
//     the event (Event.isTrusted) is one input to that judgement, not the
//     judgement.
//
//   * Keys pressed faster than any person types are dropped. That is
//     KeyRateLimit.
//
// Both are plain classes with the clock passed in, so a native test can drive
// them; window.cpp feeds them from the DOM handlers and applies the verdicts.
//
// Neither is an anti-cheat: the page belongs to whoever is running it, and a
// determined bot can simulate a hand or patch the check out. It raises the
// cost of the cheap ones -- dispatchEvent, a DevTools Input.dispatchMouseEvent,
// an OS-level "move to x,y and click" -- and nothing more.

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>

/// A token bucket over fresh key presses, plus a ceiling on auto-repeat.
///
/// A rate rather than a minimum gap between two presses, because two keys a
/// person presses together arrive together: a 125 Hz keyboard puts W and D in
/// the same USB report, and the browser hands over both keydowns at the same
/// timestamp. A gap rule would drop the second key of every diagonal. The
/// bucket lets a chord through whole and only runs dry under a sustained
/// stream -- the fastest typists hold about 17 keys a second (200 wpm), and
/// their quickest bigrams run near 30 a second for a few keys, which the burst
/// absorbs.
///
/// Auto-repeat is metered on its own. It cannot share the bucket -- a held
/// Backspace repeats at up to ~30 a second on every desktop OS and would drain
/// it -- but a script can mark its keydowns `repeat: true`, so repeats get a
/// ceiling of their own, above any OS repeat rate.
class KeyRateLimit {
public:
  /// Fresh presses the bucket holds: the burst a chord or a fast run spends.
  static constexpr double kBurst = 10.0;
  /// Fresh presses it earns back per second: the sustained ceiling.
  static constexpr double kPerSecond = 20.0;
  /// The closest two auto-repeats of one stream may be (50 a second).
  static constexpr double kMinRepeatGapMillis = 20.0;

  /// Whether a keydown at `nowMillis` is let through. Spends a token when it
  /// is a fresh press and it is.
  bool admit(double nowMillis, bool repeat) {
    if (repeat) {
      if (nowMillis - lastRepeatMillis_ < kMinRepeatGapMillis) return false;
      lastRepeatMillis_ = nowMillis;
      return true;
    }
    // A clock that steps backwards earns nothing, and is not taken as the new
    // starting point either -- that would pay out the step twice.
    if (!started_ || nowMillis > lastMillis_) {
      if (started_) {
        const double earned = (nowMillis - lastMillis_) * (kPerSecond / 1000.0);
        tokens_ = tokens_ + earned < kBurst ? tokens_ + earned : kBurst;
      }
      started_ = true;
      lastMillis_ = nowMillis;
    }
    if (tokens_ < 1.0) return false;
    tokens_ -= 1.0;
    return true;
  }

private:
  double tokens_ = kBurst;
  double lastMillis_ = 0;
  double lastRepeatMillis_ = -1e300;
  bool started_ = false;
};

/// One pointer event, as PointerPhysics sees it.
struct PointerSample {
  enum class Kind { Move, Press, Release, Enter, Leave };
  Kind kind = Kind::Move;
  /// When the hardware produced it (the DOM event's timeStamp), in the same
  /// clock as performance.now().
  double millis = 0;
  /// Where it says the pointer is, in CSS pixels from the canvas's corner.
  double x = 0, y = 0;
  /// How long the frame that is running had been running when the event was
  /// handled. Long means the page was stalled, and the browser has folded
  /// everything the hand did meanwhile into this one event.
  double sinceFrameMillis = 0;
  /// The browser says a script made this event, not a device.
  bool scripted = false;
};

/// Whether a pointer is moving like a physical mouse or trackpad.
///
/// Every sample gets a verdict of its own, and a sample that is not believed
/// costs exactly that sample: the caller moves it to a random point and the
/// next one is judged afresh, from where the device really is. So a rule that
/// misfires on a real hand is one glitched event, never a pointer that stays
/// random -- and the rules a MOVE is held to are only the ones a hand cannot
/// break however it is waved about:
///
///   * it does not teleport. The first event out of rest covers at most what
///     a frame of acceleration can (kMaxFirstStep). Mid-stroke the step may do
///     anything -- shaking a mouse reverses it at full speed every few frames.
///   * it does not draw with a ruler. A hand does not hold a dead-straight
///     line at a constant speed for a quarter of a second, nor repeat one
///     exact step ten times in a row. Interpolating scripts do both.
///   * it does not appear from nowhere. Coming back into the canvas it shows
///     up at an edge, near where it left, or just after the window regained
///     focus; anywhere else is a flag.
///   * the browser did not say a script made it.
///
/// A PRESS is where aim matters, so it is also judged by how the pointer got
/// to where it is pressing. It is believed only where it arrived the way a
/// hand arrives -- over several events and tens of milliseconds, speeding up
/// before it slowed down (kMinStrokeSamples, kMinStrokeMillis,
/// kMaxFirstShare) -- or where it was already resting after such a movement.
/// A position some unbelieved sample put the pointer at stays suspect for
/// clicking (not for moving) until the pointer has made one ordinary movement
/// from it; so does wherever it was when the page loaded, since that is when a
/// bot acts. A RELEASE goes with its press: a press that was moved has its
/// release moved too, or a button that acts on release would get one end of
/// a click and not the other.
///
/// The thresholds are deliberately loose, and sit well outside what a hand
/// on a high-DPI gaming mouse or a trackpad flick produces.
class PointerPhysics {
public:
  /// The furthest the first event out of rest may go, in CSS px, at one event
  /// per 60 Hz frame (scaled up when the page was stalled).
  static constexpr double kMaxFirstStep = 450.0;
  /// The frame that is written for.
  static constexpr double kFrameMillis = 1000.0 / 60.0;
  /// A frame this long was a stall: events were folded together, and a stroke
  /// that contains one is excused the arrival rule.
  static constexpr double kStallMillis = 50.0;
  /// No event for this long means the pointer came to rest: a new stroke.
  static constexpr double kRestGapMillis = 60.0;
  /// A press at the end of a stroke longer than this, in path, is believed
  /// only if the stroke was made the way a hand makes one: at least
  /// kMinStrokeSamples events over kMinStrokeMillis, the first of them no more
  /// than kMaxFirstShare of the way. An aimed movement's speed is bell-shaped
  /// over a tenth of a second or more, so its first event is a small share.
  static constexpr double kJumpPath = 60.0;
  static constexpr int kMinStrokeSamples = 3;
  static constexpr double kMinStrokeMillis = 30.0;
  static constexpr double kMaxFirstShare = 0.7;
  /// An ordinary movement, which clears a suspect position: this many
  /// believed events over this long and this far.
  static constexpr int kClearSamples = 3;
  static constexpr double kClearMillis = 30.0;
  static constexpr double kClearPath = 10.0;
  /// The ruler test: this many samples over at least this long and this far,
  /// none further than kStraightSlack from the line through the ends, at a
  /// speed or step that varies by less than kSteadyVariation. The slack is
  /// what rounding an exact line to whole pixels leaves (up to 0.71 px on a
  /// diagonal) and no more, and the window is long because the middle of a
  /// long, slow aimed movement is nearly constant in speed for a good part of
  /// a second -- it is the straightness a hand cannot hold, not the speed.
  static constexpr int kRulerSamples = 20;
  static constexpr double kRulerMillis = 250.0;
  static constexpr double kRulerPath = 80.0;
  static constexpr double kStraightSlack = 0.75;
  static constexpr double kSteadyVariation = 0.05;
  /// The repeat test: this many identical steps in a row, each at least
  /// kRepeatMinStep long. A slow hand repeats one-pixel steps all the time.
  static constexpr int kRepeatSteps = 10;
  static constexpr int kRepeatMinStep = 3;
  /// Where a pointer coming in from outside may first appear: this close to
  /// an edge, or to where it left.
  static constexpr double kEntryMargin = 160.0;
  /// How long after the window regains focus a pointer may appear anywhere.
  static constexpr double kFocusGraceMillis = 1000.0;

  /// Which rule a sample broke.
  enum class Flag { None, Scripted, Teleport, Ruler, Repeat, Nowhere, Arrival, Suspect, Press };

  /// The canvas, in CSS px, for the entry rule.
  void setBounds(double width, double height) { width_ = width; height_ = height; }

  /// The window lost or regained focus. Where the pointer went meanwhile is
  /// anyone's guess, so the next sample may be anywhere.
  void noteFocusChange(double millis) {
    focusMillis_ = millis;
    focusPending_ = true;
  }

  /// The rule the last sample broke, or None if it was believed.
  Flag lastFlag() const { return lastFlag_; }
  bool lastBelieved() const { return lastFlag_ == Flag::None; }

  /// Judges one sample. True when its position may be used as it stands.
  bool judge(const PointerSample& s) {
    Flag flag = s.scripted ? Flag::Scripted : Flag::None;
    const auto raise = [&flag](Flag f) { if (flag == Flag::None) flag = f; };
    const bool stalled = s.sinceFrameMillis > kStallMillis;

    // Where the pointer was is not known: a fresh track starts here.
    bool fresh = !has_;
    if (has_ && !s.scripted && focusPending_ && s.millis - focusMillis_ <= kFocusGraceMillis) {
      fresh = true;
    }
    if (has_ && !s.scripted && s.kind == PointerSample::Kind::Enter &&
        (nearEdge(s) || (hasExit_ && distance(s, exit_) <= kEntryMargin))) {
      fresh = true;
    }
    focusPending_ = false;

    if (fresh) {
      // A return the browser vouches for clears suspicion; the page's very
      // first sample does not -- see the class comment.
      if (has_) suspect_ = false;
      has_ = true;
      beginStroke(s, s.millis);
      stroke_.samples = 1;
      repeatRun_ = 0;
      lastDx_ = lastDy_ = 0;
    } else {
      // Back in from outside, in the middle of the canvas, far from where it
      // left: it did not cross the edge to get there.
      if (s.kind == PointerSample::Kind::Enter) raise(Flag::Nowhere);

      const double dt = s.millis - last_.millis;
      const double step = distance(s, last_);
      if (dt > kRestGapMillis && !stalled) {
        // At rest until now: a new stroke, setting off from where it rested.
        beginStroke(last_, s.millis);
        repeatRun_ = 0;
      }
      if (stroke_.samples == 0) {
        stroke_.firstStep = step;
        const double frames =
            s.sinceFrameMillis > kFrameMillis ? s.sinceFrameMillis / kFrameMillis : 1.0;
        if (step > kMaxFirstStep * frames) raise(Flag::Teleport);
      }
      stroke_.samples += 1;
      stroke_.path += step;
      stroke_.lastMillis = s.millis;
      stroke_.stalled = stroke_.stalled || stalled;
      pushPoint(s);

      if (s.kind == PointerSample::Kind::Move) {
        const int dx = static_cast<int>(std::lround(s.x - last_.x));
        const int dy = static_cast<int>(std::lround(s.y - last_.y));
        const bool same = dx == lastDx_ && dy == lastDy_ &&
                          (std::abs(dx) >= kRepeatMinStep || std::abs(dy) >= kRepeatMinStep);
        repeatRun_ = same ? repeatRun_ + 1 : 1;
        lastDx_ = dx;
        lastDy_ = dy;
        if (repeatRun_ >= kRepeatSteps) raise(Flag::Repeat);
        if (onARuler()) raise(Flag::Ruler);
      }
    }

    if (s.kind == PointerSample::Kind::Press) {
      if (isJump(stroke_)) raise(Flag::Arrival);
      if (stroke_.flagged || suspect_) raise(Flag::Suspect);
    }
    if (s.kind == PointerSample::Kind::Release && pressMoved_) raise(Flag::Press);

    last_ = s;
    if (s.kind == PointerSample::Kind::Leave) {
      exit_ = s;
      hasExit_ = true;
    }
    if (s.kind == PointerSample::Kind::Press) pressMoved_ = flag != Flag::None;

    if (flag != Flag::None) {
      // Whatever put the pointer here was no hand, so here is suspect for
      // clicking until it has moved on the way a hand moves.
      stroke_.flagged = true;
      suspect_ = true;
    } else if (suspect_ && !stroke_.flagged && stroke_.samples >= kClearSamples &&
               stroke_.lastMillis - stroke_.firstMillis >= kClearMillis &&
               stroke_.path >= kClearPath) {
      suspect_ = false;
    }
    lastFlag_ = flag;
    return flag == Flag::None;
  }

private:
  struct Stroke {
    int samples = 0;
    double path = 0;
    double firstStep = 0;
    double firstMillis = 0, lastMillis = 0;
    bool stalled = false;
    bool flagged = false;
  };
  struct Point { double x, y, millis; };

  static double distance(const PointerSample& a, const PointerSample& b) {
    return std::hypot(a.x - b.x, a.y - b.y);
  }

  bool nearEdge(const PointerSample& s) const {
    return s.x <= kEntryMargin || s.y <= kEntryMargin || s.x >= width_ - kEntryMargin ||
           s.y >= height_ - kEntryMargin;
  }

  static bool isJump(const Stroke& stroke) {
    if (stroke.stalled || stroke.path <= kJumpPath) return false;
    return stroke.samples < kMinStrokeSamples ||
           stroke.lastMillis - stroke.firstMillis < kMinStrokeMillis ||
           stroke.firstStep > kMaxFirstShare * stroke.path;
  }

  // A stroke that sets off from `origin`, its first sample to come at
  // `millis`. The origin is a point on its path but not one of its samples.
  void beginStroke(const PointerSample& origin, double millis) {
    stroke_ = Stroke{};
    stroke_.firstMillis = stroke_.lastMillis = millis;
    pointCount_ = 0;
    pushPoint(origin);
  }

  void pushPoint(const PointerSample& s) {
    points_[pointHead_] = Point{s.x, s.y, s.millis};
    pointHead_ = (pointHead_ + 1) % kRulerSamples;
    if (pointCount_ < kRulerSamples) ++pointCount_;
  }

  // The last kRulerSamples points of this stroke, oldest first.
  const Point& point(int i) const {
    return points_[(pointHead_ + kRulerSamples - pointCount_ + i) % kRulerSamples];
  }

  bool onARuler() const {
    if (pointCount_ < kRulerSamples) return false;
    const Point& a = point(0);
    const Point& b = point(kRulerSamples - 1);
    const double chord = std::hypot(b.x - a.x, b.y - a.y);
    if (b.millis - a.millis < kRulerMillis || chord < kRulerPath) return false;
    for (int i = 1; i < kRulerSamples - 1; ++i) {
      const Point& p = point(i);
      const double off = std::fabs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / chord;
      if (off > kStraightSlack) return false;
    }
    // Steady either per event (a loop stepping a fixed distance) or per
    // millisecond (a loop stepping by elapsed time).
    double steps[kRulerSamples - 1];
    double speeds[kRulerSamples - 1];
    bool timed = true;
    for (int i = 0; i < kRulerSamples - 1; ++i) {
      const Point& p = point(i);
      const Point& q = point(i + 1);
      steps[i] = std::hypot(q.x - p.x, q.y - p.y);
      const double dt = q.millis - p.millis;
      if (dt <= 0) timed = false;
      speeds[i] = dt > 0 ? steps[i] / dt : 0;
    }
    return variation(steps, kRulerSamples - 1) < kSteadyVariation ||
           (timed && variation(speeds, kRulerSamples - 1) < kSteadyVariation);
  }

  // Coefficient of variation: spread relative to the mean.
  static double variation(const double* values, int n) {
    double mean = 0;
    for (int i = 0; i < n; ++i) mean += values[i];
    mean /= n;
    if (mean <= 0) return 1.0;
    double spread = 0;
    for (int i = 0; i < n; ++i) spread += (values[i] - mean) * (values[i] - mean);
    return std::sqrt(spread / n) / mean;
  }

  double width_ = 0, height_ = 0;
  bool has_ = false;
  PointerSample last_;
  int lastDx_ = 0, lastDy_ = 0, repeatRun_ = 0;
  Stroke stroke_;
  Point points_[kRulerSamples] = {};
  int pointHead_ = 0, pointCount_ = 0;
  bool hasExit_ = false;
  PointerSample exit_;
  double focusMillis_ = -1e300;
  bool focusPending_ = false;
  /// Clicking here is suspect: see the class comment. True from the start.
  bool suspect_ = true;
  bool pressMoved_ = false;
  Flag lastFlag_ = Flag::None;
};
