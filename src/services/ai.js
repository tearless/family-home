const { db, getOrCreateCategory } = require('../db');
const { slugify } = require('./text');

async function settingsMap() {
  const rows = await db.all('SELECT setting_key, setting_value FROM api_settings');
  const map = rows.reduce((acc, row) => {
    acc[row.setting_key] = row.setting_value || '';
    return acc;
  }, {});

  if (!map.ai_provider && process.env.AI_PROVIDER) map.ai_provider = process.env.AI_PROVIDER;
  if (!map.ai_url && process.env.AI_URL) map.ai_url = process.env.AI_URL;
  if (!map.ai_key && process.env.AI_KEY) map.ai_key = process.env.AI_KEY;
  if (!map.ai_model && process.env.AI_MODEL) map.ai_model = process.env.AI_MODEL;

  if (!map.ai_key && process.env.OPENAI_API_KEY) map.ai_key = process.env.OPENAI_API_KEY;
  if (!map.ai_model && process.env.OPENAI_MODEL) map.ai_model = process.env.OPENAI_MODEL;
  if (!map.ai_provider && map.ai_key && !map.ai_url) map.ai_provider = 'openai';

  return map;
}

async function saveSettings(input = {}) {
  const allowedKeys = [
    'ai_provider',
    'ai_url',
    'ai_key',
    'ai_model',
    'ai_blog_system_prompt',
    'ai_category_system_prompt'
  ];

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      await db.run(
        `INSERT INTO api_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
        key,
        String(input[key] || '').trim()
      );
    }
  }
}

function parseJsonFromText(text = '') {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

function openAiEndpoint(settings) {
  return settings.ai_url || process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
}

async function callOpenAiJson({ task, systemPrompt, input, settings }) {
  const apiKey = settings.ai_key;
  if (!apiKey) return null;

  const model = settings.ai_model || 'gpt-4.1-mini';
  const endpoint = openAiEndpoint(settings);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${systemPrompt}\nReturn only one valid JSON object with no markdown fences.`
          },
          {
            role: 'user',
            content: JSON.stringify({ task, input })
          }
        ]
      })
    });

    if (!response.ok) return null;

    const json = await response.json();
    const content =
      json && json.choices && json.choices[0] && json.choices[0].message
        ? json.choices[0].message.content
        : '';

    if (!content || typeof content !== 'string') return null;
    return parseJsonFromText(content);
  } catch (_) {
    return null;
  }
}

async function callCustomJson({ task, systemPrompt, input, settings }) {
  const apiUrl = settings.ai_url;
  const apiKey = settings.ai_key;

  if (!apiUrl || !apiKey) return null;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        provider: settings.ai_provider || 'custom',
        model: settings.ai_model || 'default',
        task,
        systemPrompt,
        input
      })
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await response.json();
      if (json && typeof json === 'object') {
        if (json.output && typeof json.output === 'object') return json.output;
        return json;
      }
    }

    const text = await response.text();
    return parseJsonFromText(text);
  } catch (_) {
    return null;
  }
}

async function callConfiguredAi({ task, systemPrompt, input }) {
  const settings = await settingsMap();
  const provider = String(settings.ai_provider || '').toLowerCase();

  if (provider === 'openai' || provider === 'gpt') {
    return callOpenAiJson({ task, systemPrompt, input, settings });
  }

  return callCustomJson({ task, systemPrompt, input, settings });
}

async function testAiConnection() {
  const settings = await settingsMap();
  const provider = String(settings.ai_provider || '').toLowerCase();

  if (!settings.ai_key) {
    return { ok: false, message: 'AI key is missing. Set API Key first.' };
  }

  if (provider === 'openai' || provider === 'gpt') {
    const endpoint = openAiEndpoint(settings);
    const model = settings.ai_model || 'gpt-4.1-mini';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.ai_key}`
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Return JSON only.' },
            { role: 'user', content: '{"ping":"ok"}' }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          ok: false,
          message: `OpenAI test failed (${response.status}). ${errorText.slice(0, 240)}`
        };
      }

      const json = await response.json();
      const content =
        json && json.choices && json.choices[0] && json.choices[0].message
          ? json.choices[0].message.content
          : '';

      return {
        ok: true,
        message: `OpenAI connected. model=${model} response=${String(content || '').slice(0, 120)}`
      };
    } catch (error) {
      return { ok: false, message: `OpenAI test error: ${error.message}` };
    }
  }

  const result = await callConfiguredAi({
    task: 'connection_test',
    systemPrompt: 'Return JSON {"status":"ok","message":"connected"}.',
    input: { ping: 'ok' }
  });

  if (result && typeof result === 'object') {
    return { ok: true, message: `Custom AI connected: ${JSON.stringify(result).slice(0, 120)}` };
  }

  return {
    ok: false,
    message: 'AI test failed. Check provider, URL, key, and model.'
  };
}

function fallbackCategory({ title = '', caption = '' }) {
  const text = `${title} ${caption}`.toLowerCase();

  if (/beach|trip|travel|vacation|walk|mountain|바다|여행|산책/.test(text)) return 'Travel';
  if (/cake|cookie|baking|dinner|food|meal|요리|베이킹|음식/.test(text)) return 'Food';
  if (/birthday|party|celebration|anniversary|생일|파티|기념/.test(text)) return 'Celebration';
  if (/park|garden|sun|picnic|outdoor|숲|공원|피크닉/.test(text)) return 'Outdoor';
  return 'Everyday';
}

async function categorizePhoto({ title, caption, imageUrl }) {
  const categories = await db.all('SELECT name FROM photo_categories ORDER BY name ASC');
  const categoryNames = categories.map((row) => row.name);

  const settings = await settingsMap();
  const aiResult = await callConfiguredAi({
    task: 'photo_category',
    systemPrompt:
      settings.ai_category_system_prompt ||
      'Choose a short category name for a family photo. Respond in JSON {"categoryName":"..."}.',
    input: {
      title,
      caption,
      imageUrl,
      existingCategories: categoryNames
    }
  });

  const aiCategory = aiResult && typeof aiResult.categoryName === 'string'
    ? aiResult.categoryName.trim()
    : '';

  const selectedName = aiCategory || fallbackCategory({ title, caption });
  const category = await getOrCreateCategory(selectedName);
  return category;
}

function fallbackBlog({ prompt, author }) {
  const cleanPrompt = prompt.trim();
  const title = cleanPrompt.length > 6 ? cleanPrompt.slice(0, 60) : `Family Note by ${author}`;
  const summary = `A new family update inspired by: ${cleanPrompt || "today's moments"}.`;
  const content = [
    "## Today's Story",
    cleanPrompt || 'We had a warm and meaningful family day.',
    '',
    '## Highlights',
    '- Shared smiles and conversations',
    '- Captured a few memorable moments',
    '- Planned our next little adventure'
  ].join('\n');

  return {
    title,
    summary,
    content,
    coverImage: ''
  };
}

async function generateBlogFromPrompt({ prompt, author }) {
  const settings = await settingsMap();

  const aiResult = await callConfiguredAi({
    task: 'blog_draft',
    systemPrompt:
      settings.ai_blog_system_prompt ||
      'Write a short family blog post in markdown and respond in JSON with title, summary, content, coverImage.',
    input: { prompt, author }
  });

  if (aiResult && aiResult.title && aiResult.summary && aiResult.content) {
    return {
      title: String(aiResult.title).trim(),
      summary: String(aiResult.summary).trim(),
      content: String(aiResult.content).trim(),
      coverImage: String(aiResult.coverImage || '').trim()
    };
  }

  return fallbackBlog({ prompt, author });
}

async function reviseBlogDraft({ instruction, draft, author }) {
  const safeDraft = {
    title: String(draft.title || '').trim(),
    summary: String(draft.summary || '').trim(),
    content: String(draft.content || '').trim(),
    coverImage: String(draft.coverImage || '').trim()
  };

  const settings = await settingsMap();
  const aiResult = await callConfiguredAi({
    task: 'blog_revise',
    systemPrompt:
      settings.ai_blog_system_prompt ||
      'Revise a family blog draft based on instruction and respond in JSON with title, summary, content, coverImage, assistantMessage.',
    input: {
      author,
      instruction,
      draft: safeDraft
    }
  });

  if (aiResult && aiResult.title && aiResult.summary && aiResult.content) {
    return {
      draft: {
        title: String(aiResult.title).trim(),
        summary: String(aiResult.summary).trim(),
        content: String(aiResult.content).trim(),
        coverImage: String(aiResult.coverImage || '').trim()
      },
      assistantMessage: String(aiResult.assistantMessage || 'Draft updated based on your instruction.').trim()
    };
  }

  const updated = {
    ...safeDraft,
    summary: safeDraft.summary || `Updated by ${author}`,
    content: `${safeDraft.content}\n\n## Revision Note\n${instruction}`
  };

  return {
    draft: updated,
    assistantMessage: 'AI endpoint is not configured, so a local revision draft was generated.'
  };
}

async function uniqueBlogSlug(title) {
  const baseSlug = slugify(title) || 'family-blog';
  let slug = baseSlug;
  let index = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const found = await db.get('SELECT id FROM blog_posts WHERE slug = ?', slug);
    if (!found) break;
    slug = `${baseSlug}-${index}`;
    index += 1;
  }
  return slug;
}

module.exports = {
  settingsMap,
  saveSettings,
  testAiConnection,
  categorizePhoto,
  generateBlogFromPrompt,
  reviseBlogDraft,
  uniqueBlogSlug
};
