class ApplicationController < ActionController::Base
  protect_from_forgery with: :exception

private

  def admin_user?
    logged_in? && current_user.admin?
  end
  helper_method :admin_user?

  def logged_in?
    current_user.present?
  end
  helper_method :logged_in?

  def current_user
    @current_user ||= User.find_by(id: session[:user_id])
  end
  helper_method :current_user
end
