class User < ActiveRecord::Base
  def admin?
    true
  end
end
