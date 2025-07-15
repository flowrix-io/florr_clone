from potrace import Bitmap, Parser
import numpy as np
from PIL import Image

def png_to_svg(png_path, svg_path):
    """Converts a PNG file to SVG using potrace."""
    try:
        img = Image.open(png_path).convert('L')  # Convert to grayscale
        data = np.array(img)
        bitmap = Bitmap(data)
        path = bitmap.trace()
        with open(svg_path, 'w') as f:
            f.write(path.svg())
    except Exception as e:
        print(f"Error during conversion: {e}")