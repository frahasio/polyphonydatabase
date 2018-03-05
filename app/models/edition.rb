class Edition < ActiveRecord::Base
  belongs_to :unique_piece, inverse_of: :editions
  belongs_to :group
end
