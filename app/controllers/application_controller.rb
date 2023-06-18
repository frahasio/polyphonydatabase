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
    return nil if session[:user_id].blank?

    @current_user ||= User.find_by(id: session[:user_id])
  end
  helper_method :current_user

  def sort_order
    case params[:order]
    when "desc"
      "desc"
    else
      "asc"
    end
  end

  def invert_sort_order
    sort_order == "asc" ? "desc" : "asc"
  end
  helper_method :invert_sort_order
end
