export interface Point {
  x: number;
  y: number;
}

export interface Food {
  x: number;
  y: number;
  color: string;
}

export enum GameState {
  LOADING_MODEL = 'LOADING_MODEL',
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER'
}
