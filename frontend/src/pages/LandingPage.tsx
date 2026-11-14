import { Link } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { useAuth } from '../auth/useAuth'
import './Marketing.css'

const features = [
  { icon: 'layers' as const, title: 'A map of your code', text: 'Tree-sitter extracts symbols and relationships so important structure is ready to explore.' },
  { icon: 'search' as const, title: 'Grounded code search', text: 'Search source with structural evidence, and combine it with semantic matches when available.' },
  { icon: 'flow' as const, title: 'Follow the connections', text: 'Inspect declarations and move between callers and callees using repository graph data.' },
]

export function LandingPage() {
  const { status } = useAuth()
  const startPath = status === 'authenticated' ? '/dashboard' : '/register'
  return <div className="marketing-page landing-page">
    <header className="marketing-header">
      <Link className="marketing-brand" to="/"><span className="marketing-brand-mark"><Icon name="brand" size={21} /></span><span>repo<span className="brand-dot">·</span>ai</span></Link>
      <nav aria-label="Main navigation"><Link className="docs-nav-highlight" to="/docs"><Icon name="book" size={16} />Documentation<Icon name="arrow" size={14} /></Link></nav>
    </header>

    <main>
      <section className="landing-hero">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="hero-kicker-dot" />REPOSITORY INTELLIGENCE, GROUNDED IN YOUR CODE</div>
          <h1>Get to know<br />your <span>codebase.</span></h1>
          <p>Repo-AI maps the symbols, relationships, and source evidence inside a repository—so you can find the right code and understand how it connects.</p>
          <div className="hero-actions"><Link className="marketing-button primary" to={startPath}>{status === 'authenticated' ? 'Open your workspace' : 'Get started'}<Icon name="arrow" size={17} /></Link><Link className="marketing-button secondary" to="/demo">Try Demo<Icon name="arrow" size={16} /></Link></div>
          <div className="hero-trust"><span><Icon name="check" size={14} />Repository-scoped</span><span><Icon name="check" size={14} />Source-grounded</span><span><Icon name="check" size={14} />Deterministic graph</span></div>
        </div>
        <div className="hero-visual" aria-label="Illustration of repository symbols and relationships" role="img">
          <div className="visual-glow" />
          <div className="visual-window">
            <div className="visual-window-bar"><span /><span /><span /><div>repository map <b>·</b> payments</div><Icon name="spark" size={15} /></div>
            <div className="visual-map">
              <div className="map-file"><span className="map-file-icon"><Icon name="folder" size={14} /></span><span><strong>src/services</strong><small>3 declarations</small></span><span className="map-count">03</span></div>
              <div className="map-connector vertical" />
              <div className="map-node service"><span className="node-symbol">C</span><span><strong>PaymentService</strong><small>CLASS · PaymentService.ts</small></span><span className="node-chip">STRUCTURE</span></div>
              <div className="map-branches"><span /><span /></div>
              <div className="map-children"><div className="map-node method"><span className="node-symbol">ƒ</span><span><strong>reconcilePayment</strong><small>METHOD · 42–78</small></span><Icon name="arrow" size={15} /></div><div className="map-node method"><span className="node-symbol violet">ƒ</span><span><strong>validateSettlement</strong><small>METHOD · 91–106</small></span><Icon name="arrow" size={15} /></div></div>
              <div className="visual-evidence"><span className="evidence-dot" /><span>Grounded evidence</span><strong>PaymentService.ts</strong><code>Lines 42–78</code><span className="evidence-source">STRUCTURAL</span></div>
            </div>
            <div className="visual-footer"><span><i /> symbols indexed</span><span>CALLS <b>→</b> relationship</span><span>Evidence stays traceable</span></div>
          </div>
          <div className="hero-orbit orbit-a" /><div className="hero-orbit orbit-b" />
        </div>
      </section>

      <section className="landing-capabilities" id="capabilities">
        <div className="landing-section-heading"><span className="section-kicker">ONE REPOSITORY, MORE CONTEXT</span><h2>Understand the shape of a codebase.</h2><p>Use connected views to move from a question to the source that answers it.</p></div>
        <div className="capability-grid">{features.map(feature => <article className="capability-card" key={feature.title}><span className="capability-icon"><Icon name={feature.icon} size={19} /></span><h3>{feature.title}</h3><p>{feature.text}</p><Link to="/docs">Explore the workflow <Icon name="arrow" size={14} /></Link></article>)}</div>
      </section>

      <section className="landing-benefits">
        <div className="benefit-copy"><span className="section-kicker">BUILT FOR THE FIRST WEEK IN A NEW CODEBASE</span><h2>Spend less time guessing where things live.</h2><p>Repo-AI combines deterministic structure with retrieved source evidence. You can inspect what the index found and follow the relationships it recorded.</p><Link to="/docs" className="inline-doc-link">Read the product guide <Icon name="arrow" size={15} /></Link></div>
        <div className="benefit-list"><article><span>01</span><div><h3>Start with reliable structure</h3><p>Browse symbols by file and inspect their declarations and source context.</p></div></article><article><span>02</span><div><h3>Keep evidence close</h3><p>Search results show source locations and provenance when the backend returns them.</p></div></article><article><span>03</span><div><h3>Explore connections</h3><p>Move through direct callers and callees without losing the selected repository.</p></div></article></div>
      </section>

      <section className="landing-bottom-cta"><div><span className="section-kicker">YOUR NEXT REPOSITORY, MADE CLEARER</span><h2>Start with a codebase you want to understand.</h2></div><Link className="marketing-button primary" to={startPath}>{status === 'authenticated' ? 'Go to workspace' : 'Create your account'}<Icon name="arrow" size={16} /></Link></section>
    </main>

    <footer className="marketing-footer"><Link className="marketing-brand" to="/"><span className="marketing-brand-mark"><Icon name="brand" size={18} /></span><span>repo<span className="brand-dot">·</span>ai</span></Link><p>Understand the structure. Follow the evidence.</p><nav aria-label="Footer navigation"><Link to={startPath}>{status === 'authenticated' ? 'Workspace' : 'Get started'}</Link></nav><small>Repository Intelligence</small></footer>
  </div>
}
