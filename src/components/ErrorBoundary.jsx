import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('Error Boundary caught error:', error, errorInfo);
    
    if (window && window.Sentry) {
      window.Sentry.captureException(error);
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary__content">
            <div className="error-boundary__icon">⚠️</div>
            <h2 className="error-boundary__title">页面加载出错</h2>
            <p className="error-boundary__message">
              抱歉，页面加载时出现了问题。请检查网络连接后重试。
            </p>
            {this.state.errorInfo && (
              <details className="error-boundary__details">
                <summary>查看详情</summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error?.message}</pre>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.errorInfo?.componentStack}</pre>
              </details>
            )}
            <button
              className="error-boundary__retry"
              onClick={this.handleRetry}
            >
              重新加载页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;