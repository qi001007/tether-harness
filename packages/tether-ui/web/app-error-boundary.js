export function createAppErrorBoundary(React) {
  return class AppErrorBoundary extends React.Component {
    constructor(props) {
      super(props)
      this.state = { error: null }
    }
    static getDerivedStateFromError(error) {
      return { error }
    }
    componentDidCatch(error) {
      console.error('Tether UI render failed', error)
    }
    render() {
      if (!this.state.error) return this.props.children
      return React.createElement('div', { role: 'alert', style: { padding: 24, color: '#b42318', font: '14px/1.6 Segoe UI, sans-serif' } },
        React.createElement('div', null, '界面遇到错误，请重试重新加载。'),
        React.createElement('button', { type: 'button', onClick: () => this.setState({ error: null }), style: { marginTop: 12, padding: '6px 12px', cursor: 'pointer' } }, '重试'))
    }
  }
}
