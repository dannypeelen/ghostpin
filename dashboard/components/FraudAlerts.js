import { AlertTriangle, Shield, Clock, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

export default function FraudAlerts({ alerts }) {
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high':
        return 'text-red-600 bg-red-100 border-red-200';
      case 'medium':
        return 'text-yellow-600 bg-yellow-100 border-yellow-200';
      case 'low':
        return 'text-blue-600 bg-blue-100 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-100 border-gray-200';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'high':
        return AlertTriangle;
      case 'medium':
        return Shield;
      case 'low':
        return Clock;
      default:
        return AlertTriangle;
    }
  };

  if (alerts.length === 0) {
    return (
      <div className="text-center py-8">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Active Alerts</h3>
        <p className="text-gray-600">All systems are operating normally.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {alerts.slice(0, 5).map((alert, index) => {
        const SeverityIcon = getSeverityIcon(alert.severity);
        const severityColor = getSeverityColor(alert.severity);
        
        return (
          <div 
            key={alert.id || index}
            className={`border rounded-lg p-4 ${severityColor}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start">
                <SeverityIcon className="h-5 w-5 mt-0.5 mr-3 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center mb-1">
                    <h4 className="text-sm font-semibold capitalize">
                      {alert.alert_type?.replace('_', ' ')}
                    </h4>
                    <span className={`ml-2 px-2 py-1 text-xs font-medium rounded-full ${severityColor}`}>
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">
                    {alert.description}
                  </p>
                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="h-3 w-3 mr-1" />
                    {format(new Date(alert.created_at), 'MMM d, HH:mm')}
                  </div>
                </div>
              </div>
              {!alert.resolved && (
                <button className="ml-4 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700">
                  Resolve
                </button>
              )}
            </div>
          </div>
        );
      })}
      
      {alerts.length > 5 && (
        <div className="text-center">
          <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            View {alerts.length - 5} more alerts
          </button>
        </div>
      )}
    </div>
  );
}
