class Edition < ActiveRecord::Base
  belongs_to :unique_piece, inverse_of: :editions
  belongs_to :group
  belongs_to :editor, optional: true
end
