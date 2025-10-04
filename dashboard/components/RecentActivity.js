import { CheckCircle, XCircle, Globe, Clock, Shield } from 'lucide-react';
import { format } from 'date-fns';

export default function RecentActivity({ activity }) {
  const getStatusIcon = (verified) => {
    return verified ? CheckCircle : XCircle;
  };

  const getStatusColor = (verified) => {
    return verified ? 'text-green-600' : 'text-red-600';
  };

  const getReasonColor = (reason) => {
    if (reason?.includes('valid') || reason?.includes('passed')) {
      return 'text-green-600';
    }
    if (reason?.includes('invalid') || reason?.includes('failed')) {
      return 'text-red-600';
    }
    if (reason?.includes('mismatch') || reason?.includes('suspicious')) {
      return 'text-yellow-600';
    }
    return 'text-gray-600';
  };

  if (activity.length === 0) {
    return (
      <div className="text-center py-8">
        <Shield className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Recent Activity</h3>
        <p className="text-gray-600">No verification attempts in the last 24 hours.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activity.slice(0, 10).map((item, index) => {
        const StatusIcon = getStatusIcon(item.verified);
        const statusColor = getStatusColor(item.verified);
        const reasonColor = getReasonColor(item.reason);
        
        return (
          <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
            <StatusIcon className={`h-5 w-5 mt-0.5 ${statusColor}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  <Globe className="h-4 w-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {item.origin?.replace('https://', '').replace('http://', '')}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  {item.attestation_score && (
                    <span className="text-xs font-medium text-gray-500">
                      Score: {item.attestation_score.toFixed(2)}
                    </span>
                  )}
                  <Clock className="h-3 w-3 text-gray-400" />
                  <span className="text-xs text-gray-500">
                    {format(new Date(item.created_at), 'HH:mm')}
                  </span>
                </div>
              </div>
              
              <p className={`text-sm ${reasonColor}`}>
                {item.reason || (item.verified ? 'Verification successful' : 'Verification failed')}
              </p>
              
              {item.nonce && (
                <p className="text-xs text-gray-500 font-mono mt-1">
                  Nonce: {item.nonce.substring(0, 16)}...
                </p>
              )}
            </div>
          </div>
        );
      })}
      
      {activity.length > 10 && (
        <div className="text-center pt-2">
          <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            View {activity.length - 10} more activities
          </button>
        </div>
      )}
    </div>
  );
}
