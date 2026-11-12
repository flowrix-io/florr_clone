
import math
import random
import argparse
from xml.sax.saxutils import escape

def generate_svg(
    output="stress_test.svg",
    width=2048,
    height=2048,
    elements=10000,
    seed=42
):
    random.seed(seed)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
        """
        <defs>
          <linearGradient id="grad1" x2="1" y2="1">
            <stop offset="0%" stop-color="#ff0080"/>
            <stop offset="50%" stop-color="#00ccff"/>
            <stop offset="100%" stop-color="#ffee00"/>
          </linearGradient>
          <radialGradient id="grad2">
            <stop offset="0%" stop-color="white"/>
            <stop offset="100%" stop-color="#4400ff"/>
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="turbulence">
            <feTurbulence type="fractalNoise"
              baseFrequency="0.04" numOctaves="3"/>
            <feDisplacementMap in="SourceGraphic" scale="20"/>
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="#101018"/>
        """
    ]

    for i in range(elements):
        x = random.uniform(0, width)
        y = random.uniform(0, height)
        r = random.uniform(5, 100)
        rotation = random.uniform(0, 360)

        color = random.choice([
            "#ff0055", "#00ccff", "#ffee00",
            "#a000ff", "#00ff88", "#ff8800"
        ])

        opacity = random.uniform(0.15, 0.9)
        kind = random.randrange(8)

        if kind == 0:
            # Complex polygon
            count = random.randint(8, 50)
            points = []
            for j in range(count):
                a = j * math.tau / count
                radius = r * random.uniform(0.4, 1.0)
                points.append(
                    f"{x + math.cos(a)*radius:.2f},"
                    f"{y + math.sin(a)*radius:.2f}"
                )

            parts.append(
                f'<polygon points="{" ".join(points)}" '
                f'fill="{color}" opacity="{opacity:.3f}"/>'
            )

        elif kind == 1:
            # Bezier path with many segments
            d = f"M {x:.2f} {y:.2f}"
            px, py = x, y

            for _ in range(random.randint(10, 80)):
                cx1 = px + random.uniform(-r, r)
                cy1 = py + random.uniform(-r, r)
                cx2 = px + random.uniform(-r, r)
                cy2 = py + random.uniform(-r, r)
                nx = px + random.uniform(-r, r)
                ny = py + random.uniform(-r, r)

                d += (
                    f" C {cx1:.2f} {cy1:.2f}"
                    f" {cx2:.2f} {cy2:.2f}"
                    f" {nx:.2f} {ny:.2f}"
                )
                px, py = nx, ny

            parts.append(
                f'<path d="{d}" fill="none" '
                f'stroke="{color}" stroke-width="'
                f'{random.uniform(0.5, 5):.2f}" '
                f'opacity="{opacity:.3f}"/>'
            )

        elif kind == 2:
            # Nested circles
            parts.append(
                f'<g transform="translate({x:.2f} {y:.2f}) '
                f'rotate({rotation:.2f})">'
            )

            for j in range(random.randint(5, 30)):
                radius = r * (1 - j / 30)
                parts.append(
                    f'<circle cx="0" cy="0" r="{radius:.2f}" '
                    f'fill="none" stroke="{color}" '
                    f'stroke-width="1.5" opacity="{opacity:.3f}"/>'
                )
            parts.append('</g>')

        elif kind == 3:
            # Complex spirals
            d = ""
            steps = random.randint(100, 500)

            for j in range(steps):
                a = j * 0.15
                radius = j / steps * r
                px = x + math.cos(a) * radius
                py = y + math.sin(a) * radius

                d += ("M" if j == 0 else "L")
                d += f" {px:.2f} {py:.2f} "

            parts.append(
                f'<path d="{d}" fill="none" stroke="{color}" '
                f'stroke-width="2" opacity="{opacity:.3f}"/>'
            )

        elif kind == 4:
            # Rotated rounded rectangles
            parts.append(
                f'<rect x="{x-r:.2f}" y="{y-r:.2f}" '
                f'width="{r*2:.2f}" height="{r*2:.2f}" '
                f'rx="{random.uniform(2, 30):.2f}" '
                f'fill="url(#grad1)" opacity="{opacity:.3f}" '
                f'transform="rotate({rotation:.2f} {x:.2f} {y:.2f})"/>'
            )

        elif kind == 5:
            # Ellipses with complex transformations
            parts.append(
                f'<ellipse cx="{x:.2f}" cy="{y:.2f}" '
                f'rx="{r:.2f}" ry="{r*random.uniform(0.1, 2):.2f}" '
                f'fill="url(#grad2)" opacity="{opacity:.3f}" '
                f'transform="rotate({rotation:.2f} {x:.2f} {y:.2f})"/>'
            )

        elif kind == 6:
            # Dense line meshes
            d = ""
            for _ in range(random.randint(50, 200)):
                x1 = x + random.uniform(-r, r)
                y1 = y + random.uniform(-r, r)
                x2 = x + random.uniform(-r, r)
                y2 = y + random.uniform(-r, r)
                d += f"M{x1:.2f},{y1:.2f}L{x2:.2f},{y2:.2f}"

            parts.append(
                f'<path d="{d}" fill="none" stroke="{color}" '
                f'stroke-width="0.7" opacity="{opacity:.3f}"/>'
            )

        else:
            # Starburst with many points
            count = random.randint(20, 100)
            points = []

            for j in range(count * 2):
                a = j * math.pi / count
                radius = r if j % 2 == 0 else r * random.uniform(0.2, 0.8)
                points.append(
                    f"{x+math.cos(a)*radius:.2f},"
                    f"{y+math.sin(a)*radius:.2f}"
                )

            parts.append(
                f'<polygon points="{" ".join(points)}" '
                f'fill="{color}" opacity="{opacity:.3f}"/>'
            )

    parts.append("</svg>")

    with open(output, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))

    print(f"Generated: {output}")
    print(f"Elements: {elements}")
    print(f"File size: {sum(map(len, parts)) / 1024:.1f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-n", "--elements", type=int, default=10000)
    parser.add_argument("-o", "--output", default="stress_test.svg")
    parser.add_argument("--width", type=int, default=2048)
    parser.add_argument("--height", type=int, default=2048)
    parser.add_argument("--seed", type=int, default=42)

    args = parser.parse_args()

    generate_svg(
        args.output,
        args.width,
        args.height,
        args.elements,
        args.seed
    )
