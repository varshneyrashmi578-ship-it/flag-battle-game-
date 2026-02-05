
export interface Country {
  code: string;
  name: string;
}

export enum GameStatus {
  STARTING = 'STARTING',
  PLAYING = 'PLAYING',
  FINISHED = 'FINISHED'
}

export enum BoundaryShape {
  CIRCLE = 'CIRCLE',
  SQUARE = 'SQUARE',
  RECTANGLE = 'RECTANGLE'
}

export enum VisualTheme {
  SPACE = 'SPACE',
  NIGHT = 'NIGHT',
  DESERT = 'DESERT',
  ARCTIC = 'ARCTIC'
}