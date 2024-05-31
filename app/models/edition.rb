class Edition < ApplicationRecord
  belongs_to :group
  belongs_to :editor, optional: true
end
