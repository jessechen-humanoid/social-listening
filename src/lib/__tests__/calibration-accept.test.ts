import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

// Spec "Mapping application requires acceptance".
describe('calibration mapping acceptance gate', () => {
  let testDb: TestDb;
  let cal: typeof import('../calibration');
  let pv: typeof import('../prompt-versions');
  const BRAND = '22222222-2222-2222-2222-222222222222';
  let setId: string;
  let promptVersionId: string;

  // 30 anchor posts with spread-out golden scores (well-correlated with the
  // simulated new-model scores below, so the gate outcome is pass).
  const golden = Array.from({ length: 30 }, (_, i) => ({
    content: `錨點貼文 ${i}`,
    platform: 'fb',
    engagement: i,
    goldenEmotion: (i % 10) + 0.5,
    goldenFavor: ((i * 3) % 10) + 0.3,
  }));

  beforeAll(async () => {
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    cal = await import('../calibration');
    pv = await import('../prompt-versions');

    await testDb.db.query(`INSERT INTO brands (id, name) VALUES ($1, '麥當勞')`, [BRAND]);
    const set = await cal.createCalibrationSet({
      name: 'v1 golden',
      brandId: BRAND,
      goldenModel: 'gpt-4o-2024-05-13',
      goldenPromptVersionId: (await pv.getActivePrompt('A_emotion_favor'))!.id,
      posts: golden,
    });
    setId = set.id;
    promptVersionId = (await pv.getActivePrompt('A_emotion_favor'))!.id;
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('records a mapping as unaccepted, hides it until accepted, and resets on re-record', async () => {
    // New model scores = golden + small offset (rank-preserving → gate passes).
    const newEmotion = golden.map((g) => Math.min(10, g.goldenEmotion + 0.4));
    const newFavor = golden.map((g) => Math.min(10, g.goldenFavor + 0.2));

    const recorded = await cal.recordCalibrationMapping({
      setId,
      newModel: 'gpt-5-new',
      newPromptVersionId: promptVersionId,
      newRawEmotion: newEmotion,
      newRawFavor: newFavor,
    });
    expect(recorded.accepted).toBe(false);

    // Unaccepted → invisible to appliers (pass-through calibration).
    expect(await cal.getCalibrationMapping(setId, 'gpt-5-new', promptVersionId)).toBeNull();

    // Accepted → visible.
    await cal.acceptCalibrationMapping(recorded.id);
    const visible = await cal.getCalibrationMapping(setId, 'gpt-5-new', promptVersionId);
    expect(visible).not.toBeNull();
    expect(visible!.accepted).toBe(true);

    // Re-record → acceptance resets, mapping hidden again.
    await cal.recordCalibrationMapping({
      setId,
      newModel: 'gpt-5-new',
      newPromptVersionId: promptVersionId,
      newRawEmotion: newEmotion.map((v) => Math.min(10, v + 0.1)),
      newRawFavor: newFavor,
    });
    expect(await cal.getCalibrationMapping(setId, 'gpt-5-new', promptVersionId)).toBeNull();
  });
});
