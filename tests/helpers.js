// Small headless worlds for the tests: no renderer, no workers.
import { B } from '../src/blocks.js';
import { CHUNK, HEIGHT } from '../src/constants.js';
import { World } from '../src/world.js';
import { BlockUpdater } from '../src/blockupdates.js';

// A world whose chunks are flat stone up to and including y = groundY.
export function flatWorld(radius = 1, groundY = 10) {
  const w = new World(1);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const blocks = new Uint8Array(CHUNK * CHUNK * HEIGHT);
      blocks.fill(B.STONE, 0, CHUNK * CHUNK * (groundY + 1));
      const c = w.makeChunk(cx, cz);
      w.chunks.set(c.key, c);
      w.acceptChunk(c, blocks);
    }
  }
  return w;
}

export function generatedWorld(seed, radius, dimension = 'overworld') {
  const w = new World(seed, dimension);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) w.ensureChunk(cx, cz);
  }
  return w;
}

// Just enough of the Game for block updates to run: neighbour updates,
// scheduled fluid ticks and natural block breaking.
export function blockSim(world) {
  const broken = [];
  const game = {
    world,
    tickCount: 0,
    player: { pos: [0, 0, 0] },
    entities: { add() {} },
    sound() {},
    particles: { burst() {}, blockBreak() {} },
    breakNaturally(x, y, z) {
      broken.push([x, y, z, world.getBlock(x, y, z)]);
      world.setBlock(x, y, z, B.AIR);
    },
    lightAt: () => 15,
  };
  const updater = new BlockUpdater(game);
  world.onChange = (x, y, z, old, id) => updater.changed(world, x, y, z, old, id);
  return {
    game,
    updater,
    broken,
    run(ticks) {
      for (let i = 0; i < ticks; i++) {
        game.tickCount++;
        updater.process();
        updater.runScheduled();
      }
    },
  };
}
