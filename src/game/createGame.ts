import { Game } from 'phaser';
import { createGameConfig } from './config/gameConfig';

export const createGame = (parent: string): Game => new Game(createGameConfig(parent));
