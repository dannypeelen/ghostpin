import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Globe, AlertTriangle, CheckCircle } from 'lucide-react';

export default function DomainAnalysis({ data }) {
  const chartData = data.map(item => ({
    domain: item.origin.replace('https://', '').replace('http://', ''),
    successRate: item.success_rate,
    total: item.total,
    successful: item.successful
  }));

  const suspiciousDomains = data.filter(item => 
    item.success_rate < 50 || item.total > 100 && item.success_rate < 80
  );

  return (
    <div>
      {/* Chart */}
      <div className="h-48 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="domain" 
              tick={{ fontSize: 10 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              domain={[0, 100]}
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
              }}
              formatter={(value, name) => [
                `${value}%`,
                name === 'successRate' ? 'Success Rate' : name
              ]}
              labelFormatter={(label) => `Domain: ${label}`}
            />
            <Bar 
              dataKey="successRate" 
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Suspicious Domains Alert */}
      {suspiciousDomains.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center mb-2">
            <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
            <h4 className="text-sm font-semibold text-red-800">
              Suspicious Domains Detected
            </h4>
          </div>
          <div className="space-y-2">
            {suspiciousDomains.slice(0, 3).map((domain, index) => (
              <div key={index} className="flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <Globe className="h-4 w-4 text-gray-500 mr-2" />
                  <span className="font-mono text-gray-700">
                    {domain.origin.replace('https://', '').replace('http://', '')}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="text-red-600 font-semibold">
                    {domain.success_rate}%
                  </span>
                  <span className="text-gray-500 ml-1">
                    ({domain.total} attempts)
                  </span>
                </div>
              </div>
            ))}
            {suspiciousDomains.length > 3 && (
              <p className="text-xs text-red-600">
                +{suspiciousDomains.length - 3} more suspicious domains
              </p>
            )}
          </div>
        </div>
      )}

      {/* Domain Summary */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <CheckCircle className="h-6 w-6 text-green-600 mx-auto mb-1" />
          <p className="text-sm font-semibold text-green-800">
            {data.filter(d => d.success_rate >= 80).length}
          </p>
          <p className="text-xs text-green-600">Trusted Domains</p>
        </div>
        <div className="text-center p-3 bg-red-50 rounded-lg">
          <AlertTriangle className="h-6 w-6 text-red-600 mx-auto mb-1" />
          <p className="text-sm font-semibold text-red-800">
            {data.filter(d => d.success_rate < 50).length}
          </p>
          <p className="text-xs text-red-600">High Risk Domains</p>
        </div>
      </div>
    </div>
  );
}
