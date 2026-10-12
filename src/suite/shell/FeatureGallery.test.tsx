import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FeatureGallery from './FeatureGallery';

describe('Master v2 PDF capability gallery',()=>{
  const close=()=>undefined;
  it('renders all 90 discoverable items on Home with an explicitly disabled execution control',()=>{
    const html=renderToStaticMarkup(<FeatureGallery id="catalog" category="Home" open onClose={close}/>);
    expect((html.match(/class="ml-feature-gallery-item"/g)??[])).toHaveLength(90);
    expect((html.match(/disabled=""/g)??[])).toHaveLength(90);
    expect(html).toContain('MAL-001');
    expect(html).toContain('MAL-090');
    expect(html).toContain('Expected');
    expect(html).not.toContain('aria-label="Complete"');
  });
  it('only shows relevant editing placeholders in a category',()=>{
    const html=renderToStaticMarkup(<FeatureGallery id="edit" category="Edit" open onClose={close}/>);
    expect((html.match(/class="ml-feature-gallery-item"/g)??[])).toHaveLength(13);
    expect(html).toContain('Native Inline Text Editing');
    expect(html).not.toContain('PDF to Word');
  });
  it('shows all sixteen conversions in Convert and does not enable unverified Office results',()=>{
    const html=renderToStaticMarkup(<FeatureGallery id="convert" category="Convert" open onClose={close}/>);
    expect((html.match(/class="ml-feature-gallery-item"/g)??[])).toHaveLength(16);
    for(const label of ['PDF to Word','PDF to Excel','PDF to PowerPoint'])expect(html).toContain(label);
    expect((html.match(/disabled=""/g)??[])).toHaveLength(16);
  });
  it('does not create a hidden catalog when closed',()=>{
    const html=renderToStaticMarkup(<FeatureGallery id="closed" category="Home" open={false} onClose={close}/>);
    expect(html).toBe('');
  });
});
