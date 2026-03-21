/* ═══════════════════════════════════════
   ChainRun Profile Management
   ═══════════════════════════════════════ */

const ProfileManager = {
  profiles: [],
  activeId: 'quality-plus',

  init() {
    this.profiles = [
      {
        id: 'quality-plus',
        name: 'Quality+',
        prefix: '',
        suffix: '',
        llm: '',
        builtIn: true,
        description: 'Default wrapping — optimized templates for each LLM'
      },
      {
        id: 'concise',
        name: 'Concise',
        prefix: '',
        suffix: 'Be extremely concise. Use the fewest words possible while preserving all essential information.',
        llm: '',
        builtIn: true,
        description: 'Adds conciseness constraint to every prompt'
      },
      {
        id: 'academic',
        name: 'Academic',
        prefix: 'Adopt a formal, academic tone throughout your response. Use precise terminology, cite reasoning clearly, and maintain an objective perspective.',
        suffix: '',
        llm: '',
        builtIn: true,
        description: 'Formal, academic tone with precise language'
      }
    ];
    this.activeId = 'quality-plus';
  },

  getAll() {
    return this.profiles;
  },

  getActive() {
    return this.profiles.find(p => p.id === this.activeId) || this.profiles[0];
  },

  setActive(id) {
    this.activeId = id;
  },

  add(profile) {
    const id = 'custom-' + Date.now();
    this.profiles.push({
      id,
      name: profile.name || 'Untitled',
      prefix: profile.prefix || '',
      suffix: profile.suffix || '',
      llm: profile.llm || '',
      builtIn: false,
      description: profile.description || ''
    });
    return id;
  },

  update(id, updates) {
    const idx = this.profiles.findIndex(p => p.id === id);
    if (idx !== -1 && !this.profiles[idx].builtIn) {
      Object.assign(this.profiles[idx], updates);
    }
  },

  remove(id) {
    const idx = this.profiles.findIndex(p => p.id === id);
    if (idx !== -1 && !this.profiles[idx].builtIn) {
      this.profiles.splice(idx, 1);
      if (this.activeId === id) {
        this.activeId = 'quality-plus';
      }
    }
  },

  get(id) {
    return this.profiles.find(p => p.id === id);
  }
};

// Initialize on load
ProfileManager.init();
