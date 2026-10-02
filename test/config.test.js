import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  loadConfigOrThrow,
  ConfigError,
  DEFAULT_TIMEOUT_MS,
  PROVIDER_DEFAULT_BASE_URLS,
} from '../server/config.js';

describe('loadConfig validation', () => {
  test('accepts a complete OpenAI config and applies defaults', () => {
    const { llm, errors } = loadConfig({
      LLM_PROVIDER: 'openai',
      LLM_API_KEY: 'sk-test',
      LLM_MODEL: 'gpt-4.1',
    });
    assert.deepEqual(errors, []);
    assert.equal(llm.available, true);
    assert.equal(llm.provider, 'openai');
    assert.equal(llm.baseUrl, PROVIDER_DEFAULT_BASE_URLS.openai);
    assert.equal(llm.timeoutMs, DEFAULT_TIMEOUT_MS);
    assert.equal(llm.temperature, undefined);
    assert.equal(llm.maxTokens, undefined);
  });

  test('defaults provider to openai when LLM_PROVIDER is unset', () => {
    const { llm, errors } = loadConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'm' });
    assert.deepEqual(errors, []);
    assert.equal(llm.provider, 'openai');
  });

  test('applies the xAI default base URL', () => {
    const { llm, errors } = loadConfig({
      LLM_PROVIDER: 'xai',
      LLM_API_KEY: 'xai-key',
      LLM_MODEL: 'grok-4',
    });
    assert.deepEqual(errors, []);
    assert.equal(llm.baseUrl, PROVIDER_DEFAULT_BASE_URLS.xai);
  });

  test('strips trailing slashes from a custom base URL', () => {
    const { llm } = loadConfig({
      LLM_PROVIDER: 'openai-compatible',
      LLM_API_KEY: 'k',
      LLM_MODEL: 'm',
      LLM_BASE_URL: 'https://gateway.example.com/v1/',
    });
    assert.equal(llm.baseUrl, 'https://gateway.example.com/v1');
  });

  test('reports missing API key and model together', () => {
    const { llm, errors } = loadConfig({ LLM_PROVIDER: 'openai' });
    assert.equal(llm.available, false);
    assert.ok(errors.some((e) => e.includes('LLM_API_KEY')));
    assert.ok(errors.some((e) => e.includes('LLM_MODEL')));
  });

  test('rejects unknown providers', () => {
    const { errors } = loadConfig({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'k',
      LLM_MODEL: 'm',
    });
    assert.ok(errors.some((e) => e.includes('LLM_PROVIDER')));
  });

  test('requires LLM_BASE_URL for openai-compatible providers', () => {
    const { errors } = loadConfig({
      LLM_PROVIDER: 'openai-compatible',
      LLM_API_KEY: 'k',
      LLM_MODEL: 'm',
    });
    assert.ok(errors.some((e) => e.includes('LLM_BASE_URL is required')));
  });

  test('rejects invalid base URLs and non-http schemes', () => {
    for (const bad of ['not a url', 'ftp://example.com/v1']) {
      const { errors } = loadConfig({
        LLM_API_KEY: 'k',
        LLM_MODEL: 'm',
        LLM_BASE_URL: bad,
      });
      assert.ok(errors.some((e) => e.includes('LLM_BASE_URL')), `expected error for ${bad}`);
    }
  });

  test('validates LLM_TIMEOUT_MS bounds and shape', () => {
    for (const bad of ['0', '-5', 'abc', '1.5', '999999999']) {
      const { errors } = loadConfig({
        LLM_API_KEY: 'k',
        LLM_MODEL: 'm',
        LLM_TIMEOUT_MS: bad,
      });
      assert.ok(errors.some((e) => e.includes('LLM_TIMEOUT_MS')), `expected error for ${bad}`);
    }
    const { llm, errors } = loadConfig({
      LLM_API_KEY: 'k',
      LLM_MODEL: 'm',
      LLM_TIMEOUT_MS: '1500',
    });
    assert.deepEqual(errors, []);
    assert.equal(llm.timeoutMs, 1500);
  });

  test('validates temperature and max tokens', () => {
    const { errors } = loadConfig({
      LLM_API_KEY: 'k',
      LLM_MODEL: 'm',
      LLM_TEMPERATURE: '3',
      LLM_MAX_TOKENS: '-1',
    });
    assert.ok(errors.some((e) => e.includes('LLM_TEMPERATURE')));
    assert.ok(errors.some((e) => e.includes('LLM_MAX_TOKENS')));

    const ok = loadConfig({
      LLM_API_KEY: 'k',
      LLM_MODEL: 'm',
      LLM_TEMPERATURE: '0.7',
      LLM_MAX_TOKENS: '512',
    });
    assert.equal(ok.llm.temperature, 0.7);
    assert.equal(ok.llm.maxTokens, 512);
  });

  test('loadConfigOrThrow raises a ConfigError listing every problem', () => {
    assert.throws(
      () => loadConfigOrThrow({ LLM_PROVIDER: 'nope' }),
      (error) => {
        assert.ok(error instanceof ConfigError);
        assert.ok(error.errors.some((e) => e.includes('LLM_PROVIDER')));
        assert.ok(error.errors.some((e) => e.includes('LLM_API_KEY')));
        assert.ok(error.errors.some((e) => e.includes('LLM_MODEL')));
        return true;
      },
    );
  });
});
