import { useState, useEffect } from 'react';
import Head from 'next/head';
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  TrendingUp, 
  Globe,
  Clock,
  Activity
} from 'lucide-react';
import MetricsCard from '../components/MetricsCard';
import VerificationChart from '../components/VerificationChart';
import DomainAnalysis from '../components/DomainAnalysis';
import FraudAlerts from '../components/FraudAlerts';
import RecentActivity from '../components/RecentActivity';

export default function Dashboard() {
  const [merchantId, setMerchantId] = useState('demo-merchant');
  const [metrics, setMetrics] = useState(null);
  const [charts, setCharts] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [merchantId]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [metricsRes, chartsRes, alertsRes] = await Promise.all([
        fetch(`/api/dashboard/metrics/${merchantId}?period=24h`),
        fetch(`/api/dashboard/charts/${merchantId}?period=24h`),
        fetch(`/api/dashboard/alerts/${merchantId}?status=unresolved`)
      ]);

      if (!metricsRes.ok || !chartsRes.ok || !alertsRes.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const [metricsData, chartsData, alertsData] = await Promise.all([
        metricsRes.json(),
        chartsRes.json(),
        alertsRes.json()
      ]);

      setMetrics(metricsData);
      setCharts(chartsData);
      setAlerts(alertsData);
      setError(null);
    } catch (err) {
      console.error('Dashboard data fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !metrics) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading GhostPIN Dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Dashboard Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button 
            onClick={fetchDashboardData}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>GhostPIN Dashboard</title>
        <meta name="description" content="Anti-phishing payment verification dashboard" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <Shield className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">GhostPIN Dashboard</h1>
                <p className="text-sm text-gray-500">Merchant: {merchantId}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <select 
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="demo-merchant">Demo Merchant</option>
                <option value="acme-corp">Acme Corp</option>
                <option value="secure-shop">Secure Shop</option>
              </select>
              <button 
                onClick={fetchDashboardData}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center"
              >
                <Activity className="h-4 w-4 mr-2" />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <MetricsCard
            title="Total Verifications"
            value={metrics?.metrics?.total_verifications || 0}
            icon={Shield}
            color="blue"
            trend={"+12%"}
          />
          <MetricsCard
            title="Success Rate"
            value={`${metrics?.metrics?.success_rate || 0}%`}
            icon={CheckCircle}
            color="green"
            trend={"+5%"}
          />
          <MetricsCard
            title="Failed Verifications"
            value={metrics?.metrics?.failed_verifications || 0}
            icon={XCircle}
            color="red"
            trend={"-8%"}
          />
          <MetricsCard
            title="Avg. Attestation Score"
            value={metrics?.metrics?.avg_attestation_score?.toFixed(2) || "0.00"}
            icon={TrendingUp}
            color="purple"
            trend={"+2%"}
          />
        </div>

        {/* Charts and Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Verification Trends</h3>
            <VerificationChart data={charts?.hourly_data || []} />
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Domain Analysis</h3>
            <DomainAnalysis data={charts?.domain_data || []} />
          </div>
        </div>

        {/* Fraud Alerts and Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
              Fraud Alerts
            </h3>
            <FraudAlerts alerts={alerts?.alerts || []} />
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Clock className="h-5 w-5 text-blue-500 mr-2" />
              Recent Activity
            </h3>
            <RecentActivity activity={metrics?.recent_activity || []} />
          </div>
        </div>
      </main>
    </div>
  );
}
