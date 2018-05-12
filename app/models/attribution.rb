class Attribution < ActiveRecord::Base
  belongs_to :inclusion, inverse_of: :attributions
  belongs_to :refers_to, class_name: "Composer", optional: true, inverse_of: :attributions
end
