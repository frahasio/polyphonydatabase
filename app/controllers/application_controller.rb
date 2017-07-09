class ApplicationController < ActionController::Base
  protect_from_forgery with: :exception

private

  def admin?
    false
  end
  helper_method :admin?
end
