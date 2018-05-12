class Edition < ActiveRecord::Base
  belongs_to :group
  belongs_to :editor, optional: true
end
