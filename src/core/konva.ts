// Register only the shapes this editor uses; omit unused shapes and filters.
import Konva from 'konva/lib/Core';
import { Image } from 'konva/lib/shapes/Image';
import { Rect } from 'konva/lib/shapes/Rect';
import 'konva/lib/shapes/Line';
import 'konva/lib/shapes/Text';
import 'konva/lib/shapes/Transformer';
export default Object.assign(Konva, { Image, Rect });
