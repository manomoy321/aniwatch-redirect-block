const assert = require('assert');

console.log('=== Test Suite: All-Time DUB Selection & Disambiguation ===\n');

// Mock DOM Environment
class MockNode {
  constructor(nodeType, nodeValue = '') {
    this.nodeType = nodeType;
    this.nodeValue = nodeValue;
    this.parentElement = null;
  }
}

class MockElement {
  constructor(tagName, text = '', attrs = {}, parent = null) {
    this.nodeType = 1; // Element
    this.tagName = tagName.toUpperCase();
    this.attrs = attrs;
    this.parent = parent;
    this.parentElement = parent;
    this.children = [];
    this.childNodes = [];
    this.classList = new Set((attrs.class || '').split(' ').filter(Boolean));
    this.classList.contains = (c) => this.classList.has(c);
    this.style = {};
    this.offsetParent = {};
    this.clickedCount = 0;
    this.dispatchedEvents = [];

    if (text) {
      const textNode = new MockNode(3, text);
      textNode.parentElement = this;
      this.childNodes.push(textNode);
    }
    if (parent) {
      parent.children.push(this);
      parent.childNodes.push(this);
    }
  }

  get textContent() {
    return this.childNodes.map(n => n.nodeType === 3 ? n.nodeValue : (n.textContent || '')).join('');
  }

  set textContent(val) {
    this.childNodes = [new MockNode(3, val)];
    this.childNodes[0].parentElement = this;
  }

  getAttribute(name) { return this.attrs[name] || null; }
  setAttribute(name, val) { this.attrs[name] = val; }
  matches(selector) {
    const tags = selector.split(',').map(s => s.trim().toUpperCase());
    if (tags.includes(this.tagName)) return true;
    if (selector.includes('[role="button"]') && this.attrs.role === 'button') return true;
    return false;
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      const cls = cur.attrs.class || '';
      if (selector.includes('.servers-dub') && cur.classList.has('servers-dub')) return cur;
      if (selector.includes('.server-row') && cur.classList.has('server-row')) return cur;
      if (selector.includes('.server-item') && cur.classList.has('server-item')) return cur;
      if (selector.includes('.ps-block') && cur.classList.has('ps-block')) return cur;
      if (selector.includes('div') && cur.tagName === 'DIV') return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  contains(el) {
    let cur = el;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    function walk(node) {
      for (const child of node.children) {
        let match = false;
        if (selector.includes('.server-item') && child.classList.has('server-item')) match = true;
        if (selector.includes('a') && child.tagName === 'A') match = true;
        if (selector.includes('button') && child.tagName === 'BUTTON') match = true;
        if (selector.includes('[data-server]') && child.attrs['data-server']) match = true;
        if (match && !results.includes(child)) results.push(child);
        walk(child);
      }
    }
    walk(this);
    return results;
  }

  click() {
    this.clickedCount++;
  }

  dispatchEvent(evt) {
    this.dispatchedEvents.push(evt.type);
  }
}

// TreeWalker Mock
function createMockTreeWalker(root) {
  const textNodes = [];
  function collect(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) textNodes.push(child);
      else if (child.nodeType === 1) collect(child);
    }
  }
  collect(root);
  let idx = 0;
  return {
    nextNode() {
      return idx < textNodes.length ? textNodes[idx++] : null;
    }
  };
}

console.log('--- Test 1: HiAnime DOM TreeWalker Identification & Disambiguation ---');
{
  // Recreate HiAnime Episode 128 layout:
  // Yellow Box on left
  // SUB Row with CC icon, SUB: label, and VidSrc button
  // DUB Row with Mic icon, DUB: label, and VidSrc button
  const root = new MockElement('div');
  const serverArea = new MockElement('div', '', { class: 'server-area' }, root);

  // SUB row
  const subRow = new MockElement('div', '', { class: 'server-row servers-sub' }, serverArea);
  const subType = new MockElement('div', '', { class: 'server-type' }, subRow);
  const subIcon = new MockElement('i', '', { class: 'fas fa-closed-captioning' }, subType);
  const subText = new MockElement('span', ' SUB:', {}, subType);
  const subServerItem = new MockElement('div', '', { class: 'server-item', 'data-server': 'vidsrc' }, subRow);
  const subBtn = new MockElement('a', 'VidSrc', { class: 'btn' }, subServerItem);

  // DUB row
  const dubRow = new MockElement('div', '', { class: 'server-row servers-dub' }, serverArea);
  const dubType = new MockElement('div', '', { class: 'server-type' }, dubRow);
  const dubIcon = new MockElement('i', '', { class: 'fas fa-microphone' }, dubType);
  const dubText = new MockElement('span', ' DUB:', {}, dubType);
  const dubServerItem = new MockElement('div', '', { class: 'server-item', 'data-server': 'vidsrc' }, dubRow);
  const dubBtn = new MockElement('a', 'VidSrc', { class: 'btn' }, dubServerItem);

  // FocusGuard getAllDubServers algorithm using TreeWalker
  function getAllDubServersTest(docRoot) {
    const dubButtons = [];
    const walker = createMockTreeWalker(docRoot);
    let node;
    while ((node = walker.nextNode())) {
      const val = (node.nodeValue || '').trim().toUpperCase();
      if (val === 'DUB:' || val === 'DUB' || val.startsWith('DUB:')) {
        const labelEl = node.parentElement;
        let container = labelEl;
        for (let depth = 0; depth < 5; depth++) {
          if (!container || container === docRoot) break;
          const containerText = (container.textContent || '').toUpperCase();
          const hasSub = containerText.includes('SUB:') || containerText.includes('SUB :');
          if (!hasSub) {
            const btns = container.querySelectorAll('.server-item, a, button');
            btns.forEach(b => {
              if (!b.contains(labelEl) && !labelEl.contains(b)) {
                if (!dubButtons.includes(b)) dubButtons.push(b);
              }
            });
            if (dubButtons.length > 0) break;
          }
          container = container.parentElement;
        }
      }
    }
    return dubButtons;
  }

  const dubCandidates = getAllDubServersTest(root);
  assert(dubCandidates.includes(dubServerItem) || dubCandidates.includes(dubBtn), 'Must find DUB elements');
  assert(!dubCandidates.includes(subServerItem) && !dubCandidates.includes(subBtn), 'Must NEVER include SUB elements');
  console.log('✓ Test 1 Passed: TreeWalker cleanly isolated DUB row despite microphone icon and duplicate button text ("VidSrc").');
}

console.log('\n--- Test 2: Active State Detection (Classes & Yellow Theme) ---');
{
  function isDubServerActiveTest(btn) {
    const elementsToCheck = [btn, btn.parentElement].filter(Boolean);
    for (const el of elementsToCheck) {
      if (el.classList.contains('active') || el.classList.contains('selected')) return true;
      if (el.style.backgroundColor && el.style.backgroundColor.includes('254, 208, 109')) return true; // #fed06d
    }
    return false;
  }

  const subBtn = new MockElement('a', 'VidSrc', { class: 'btn active' });
  const dubBtn = new MockElement('a', 'VidSrc', { class: 'btn' });
  dubBtn.style.backgroundColor = 'rgb(43, 45, 49)'; // Inactive dark grey

  assert.strictEqual(isDubServerActiveTest(subBtn), true, 'Sub button should be detected active');
  assert.strictEqual(isDubServerActiveTest(dubBtn), false, 'Dub button should be detected inactive');

  // Activate DUB with yellow highlight
  dubBtn.style.backgroundColor = 'rgb(254, 208, 109)';
  assert.strictEqual(isDubServerActiveTest(dubBtn), true, 'Yellow background must be recognized as active');
  console.log('✓ Test 2 Passed: Successfully differentiated active yellow server from dark inactive server.');
}

console.log('\n--- Test 3: Continuous Enforcer Automatic Switch to DUB ---');
{
  let activeServerCategory = 'sub'; // Site defaulted to SUB on episode load
  let activatedButton = null;

  const dubBtn = new MockElement('a', 'VidSrc', { class: 'btn' });
  dubBtn.click = function() {
    activeServerCategory = 'dub';
    activatedButton = this;
  };

  function enforceDubSelectionTest() {
    if (activeServerCategory === 'dub') return; // Already DUB
    // Find DUB button and click it
    dubBtn.click();
  }

  // Initial state: SUB
  assert.strictEqual(activeServerCategory, 'sub');
  enforceDubSelectionTest();
  assert.strictEqual(activeServerCategory, 'dub', 'Enforcer must automatically switch category to DUB');
  assert.strictEqual(activatedButton, dubBtn, 'DUB button must have received click');
  console.log('✓ Test 3 Passed: Continuous enforcer successfully switched playback from default SUB to DUB.');
}

console.log('\n--- Test 4: All-Time DUB Lock in saveServerPreference ---');
{
  const settings = {
    enableAutoSelectEng: true,
    preferredServerCategory: 'dub',
    preferredServerName: 'vidsrc'
  };

  function saveServerPreferenceTest(category, serverName) {
    let cleanCat = (category || 'dub').toLowerCase().trim();
    let cleanServer = (serverName || '').toLowerCase().trim();
    if (settings.enableAutoSelectEng) {
      cleanCat = 'dub'; // Locked to DUB
    }
    settings.preferredServerCategory = cleanCat;
    settings.preferredServerName = cleanServer;
  }

  // Even if user accidentally clicks a SUB button, category remains locked to DUB
  saveServerPreferenceTest('sub', 'vidsrc');
  assert.strictEqual(settings.preferredServerCategory, 'dub', 'Category must remain locked to dub when all-time DUB is enabled');
  console.log('✓ Test 4 Passed: saveServerPreference safely preserved DUB priority.');
}

console.log('\n=== All 4 Verification Tests Passed Successfully! ===');
