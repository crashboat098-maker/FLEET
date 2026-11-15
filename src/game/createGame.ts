import { Game } from 'phaser';
import { createGameConfig } from './config/gameConfig';

export const createGame = (parent: string): Game => {
    const game = new Game(createGameConfig(parent));
    // Dev-only debug handle (stripped from production builds).
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
    return game;
};
